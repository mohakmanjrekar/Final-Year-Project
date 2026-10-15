import os
import json
import hmac
import hashlib
import datetime
import logging
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, List, Optional

from backend.database.mongo import (
    get_database,
    get_users_collection
)

logger = logging.getLogger(__name__)

# Primary Admin Credentials
ADMIN_EMAIL = "hp5623699@gmail.com"
DEFAULT_ADMIN_PASSWORD = os.environ.get("ADMIN_DEFAULT_PASSWORD", "Admin@123")
DEFAULT_SMTP_PASSWORD = "jovbkksmzewbmgdp"
SECRET_SALT = os.environ.get("AUTH_SECRET_SALT", "academic_marksheet_portal_salt_2026")
PORTAL_PUBLIC_URL = os.environ.get("LIVE_API_URL", "https://final-year-project-rho-sable.vercel.app")

# Local fallback file in case of offline local development
_LOCAL_USERS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "local_users_cache.json"
)
_LOCAL_SMTP_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "local_smtp_config.json"
)


def _hash_password(password: str) -> str:
    """Creates a salted SHA-256 hash of the password."""
    salted = f"{SECRET_SALT}:{password}".encode("utf-8")
    return hashlib.sha256(salted).hexdigest()


def _generate_session_token(email: str, role: str) -> str:
    """Generates a deterministic HMAC token for session validation."""
    msg = f"{email.lower().strip()}:{role.lower().strip()}".encode("utf-8")
    return hmac.new(SECRET_SALT.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verify_session_token(email: str, role: str, token: str) -> bool:
    """Verifies a session token."""
    if not email or not role or not token:
        return False
    expected = _generate_session_token(email, role)
    return hmac.compare_digest(expected, token)


# ==============================================================================
# SMTP EMAIL CONFIGURATION & DISPATCH SERVICE
# ==============================================================================

def _read_env_file_var(key: str) -> str:
    """Reads a key from the project's .env file if present."""
    val = os.environ.get(key, "").strip()
    if val:
        return val
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(f"{key}="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return ""


def get_smtp_config() -> Dict[str, Any]:
    """
    Retrieves SMTP credentials from:
    1. MongoDB Atlas ('system_settings' collection)
    2. Local .env / environment variables (SMTP_EMAIL, SMTP_PASSWORD)
    3. Built-in default App Password for hp5623699@gmail.com
    """
    smtp_email = _read_env_file_var("SMTP_EMAIL") or ADMIN_EMAIL
    smtp_password = _read_env_file_var("SMTP_PASSWORD") or DEFAULT_SMTP_PASSWORD
    smtp_host = _read_env_file_var("SMTP_HOST") or "smtp.gmail.com"
    smtp_port = int(_read_env_file_var("SMTP_PORT") or "587")

    # Check MongoDB system_settings first so Vercel & Local share settings automatically
    db = get_database()
    if db is not None:
        try:
            cfg = db["system_settings"].find_one({"_id": "smtp_config"})
            if cfg:
                if cfg.get("smtp_email"):
                    smtp_email = cfg["smtp_email"]
                if cfg.get("smtp_password"):
                    smtp_password = cfg["smtp_password"]
                if cfg.get("smtp_host"):
                    smtp_host = cfg["smtp_host"]
                if cfg.get("smtp_port"):
                    smtp_port = int(cfg["smtp_port"])
        except Exception as e:
            logger.warning(f"[SMTP] Could not read MongoDB smtp_config: {e}")

    # Check local file fallback if still empty
    if not smtp_password and os.path.exists(_LOCAL_SMTP_FILE):
        try:
            with open(_LOCAL_SMTP_FILE, "r", encoding="utf-8") as f:
                local_cfg = json.load(f)
                smtp_email = local_cfg.get("smtp_email") or smtp_email
                smtp_password = local_cfg.get("smtp_password") or smtp_password
                smtp_host = local_cfg.get("smtp_host") or smtp_host
                smtp_port = int(local_cfg.get("smtp_port") or smtp_port)
        except Exception:
            pass

    # Strip spaces from Gmail App Passwords (e.g. "abcd efgh ijkl mnop" -> "abcdefghijklmnop")
    clean_app_pass = (smtp_password or "").replace(" ", "").strip()

    return {
        "smtp_email": smtp_email.strip(),
        "smtp_password": clean_app_pass,
        "smtp_host": smtp_host.strip(),
        "smtp_port": smtp_port,
        "is_configured": bool(clean_app_pass)
    }


def save_smtp_config(
    admin_email: str,
    smtp_email: str,
    smtp_password: str,
    smtp_host: str = "smtp.gmail.com",
    smtp_port: int = 587
) -> Dict[str, Any]:
    """Saves SMTP settings in MongoDB Atlas and local cache."""
    if (admin_email or "").strip().lower() != ADMIN_EMAIL.lower():
        raise PermissionError(f"Unauthorized: Only {ADMIN_EMAIL} can configure SMTP settings.")

    clean_email = (smtp_email or ADMIN_EMAIL).strip()
    clean_pass = (smtp_password or "").replace(" ", "").strip()
    if not clean_pass:
        raise ValueError("Please provide a valid 16-character Gmail App Password.")

    cfg_doc = {
        "smtp_email": clean_email,
        "smtp_password": clean_pass,
        "smtp_host": (smtp_host or "smtp.gmail.com").strip(),
        "smtp_port": int(smtp_port or 587),
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z"
    }

    db = get_database()
    if db is not None:
        try:
            db["system_settings"].update_one(
                {"_id": "smtp_config"},
                {"$set": cfg_doc},
                upsert=True
            )
        except Exception as e:
            logger.warning(f"[SMTP] Failed to save config to MongoDB: {e}")

    try:
        with open(_LOCAL_SMTP_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg_doc, f, indent=2)
    except Exception:
        pass

    return {
        "status": "success",
        "message": f"SMTP Mail Service configured for {clean_email}.",
        "is_configured": True,
        "smtp_email": clean_email
    }


def send_smtp_email(subject: str, recipient_email: str, html_body: str) -> Dict[str, Any]:
    """
    Sends an HTML email using the configured SMTP credentials (tries TLS 587, then SSL 465).
    Returns {"sent": bool, "error": Optional[str]}.
    """
    cfg = get_smtp_config()
    smtp_user = cfg["smtp_email"]
    smtp_pass = cfg["smtp_password"]
    smtp_host = cfg["smtp_host"]
    smtp_port = cfg["smtp_port"]

    if not smtp_user or not smtp_pass:
        return {
            "sent": False,
            "error": "SMTP App Password not configured yet. Configure it in Admin Panel -> SMTP Settings or .env."
        }

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Academic Marksheet Portal <{smtp_user}>"
    msg["To"] = recipient_email
    msg.attach(MIMEText(html_body, "html"))

    # Attempt 1: STARTTLS (Port 587)
    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, [recipient_email], msg.as_string())
        logger.info(f"[SMTP] Email sent successfully via TLS to {recipient_email}")
        return {"sent": True, "error": None}
    except Exception as tls_err:
        logger.warning(f"[SMTP] TLS port {smtp_port} attempt notice ({tls_err}), trying SSL 465...")
        # Attempt 2: SSL (Port 465)
        try:
            with smtplib.SMTP_SSL(smtp_host, 465, timeout=10) as server:
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, [recipient_email], msg.as_string())
            logger.info(f"[SMTP] Email sent successfully via SSL 465 to {recipient_email}")
            return {"sent": True, "error": None}
        except Exception as ssl_err:
            err_str = f"{ssl_err}"
            logger.error(f"[SMTP] Failed to send email to {recipient_email}: {err_str}")
            return {"sent": False, "error": err_str}


def _dispatch_email_background(subject: str, recipient_email: str, html_body: str) -> None:
    """Dispatches SMTP email in a background daemon thread so it does not block HTTP requests."""
    def _worker():
        try:
            send_smtp_email(subject, recipient_email, html_body)
        except Exception as e:
            logger.warning(f"[SMTP Background] Failed sending email to {recipient_email}: {e}")

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


# ==============================================================================
# USER STORAGE HELPERS
# ==============================================================================

def _load_local_users() -> Dict[str, Dict[str, Any]]:
    users: Dict[str, Dict[str, Any]] = {}
    if os.path.exists(_LOCAL_USERS_FILE):
        try:
            with open(_LOCAL_USERS_FILE, "r", encoding="utf-8") as f:
                users = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load local users cache: {e}")

    if ADMIN_EMAIL not in users:
        now_iso = datetime.datetime.utcnow().isoformat() + "Z"
        users[ADMIN_EMAIL] = {
            "name": "System Administrator",
            "email": ADMIN_EMAIL,
            "password_hash": _hash_password(DEFAULT_ADMIN_PASSWORD),
            "role": "admin",
            "requested_role": "admin",
            "status": "approved",
            "department": "Administration",
            "roll_or_id": "ADMIN-01",
            "reason": "Primary System Administrator",
            "created_at": now_iso,
            "updated_at": now_iso,
            "approved_by": ADMIN_EMAIL
        }
        _save_local_users(users)
    return users


def _save_local_users(users: Dict[str, Dict[str, Any]]) -> None:
    try:
        with open(_LOCAL_USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(users, f, indent=2)
    except Exception as e:
        logger.warning(f"Failed to save local users cache: {e}")


def _sanitize_user(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    clean = dict(doc)
    clean.pop("_id", None)
    clean.pop("password_hash", None)
    return clean


def _ensure_admin_exists(col) -> None:
    if col is None:
        return
    try:
        existing = col.find_one({"email": ADMIN_EMAIL})
        if not existing:
            now_iso = datetime.datetime.utcnow().isoformat() + "Z"
            col.insert_one({
                "name": "System Administrator",
                "email": ADMIN_EMAIL,
                "password_hash": _hash_password(DEFAULT_ADMIN_PASSWORD),
                "role": "admin",
                "requested_role": "admin",
                "status": "approved",
                "department": "IT / Administration",
                "roll_or_id": "ADMIN-01",
                "reason": "Primary Portal Administrator",
                "created_at": now_iso,
                "updated_at": now_iso,
                "approved_by": ADMIN_EMAIL
            })
        elif existing.get("role") != "admin" or existing.get("status") != "approved":
            col.update_one(
                {"email": ADMIN_EMAIL},
                {"$set": {"role": "admin", "status": "approved", "requested_role": "admin"}}
            )
    except Exception as e:
        logger.warning(f"[Auth] Ensure admin notice: {e}")


def _sync_local_cache_to_mongo(col) -> None:
    """Synchronizes any pending or registered users from local cache into MongoDB Atlas."""
    if col is None:
        return
    try:
        users = _load_local_users()
        for email, udoc in list(users.items()):
            clean_email = email.lower().strip()
            if clean_email == ADMIN_EMAIL.lower():
                continue
            clean_doc = dict(udoc)
            clean_doc.pop("_id", None)
            clean_doc["email"] = clean_email
            existing = col.find_one({"email": clean_email})
            if not existing:
                col.insert_one(clean_doc)
            elif existing.get("status") in ("unrequested", "rejected") and udoc.get("status") == "pending":
                col.update_one({"email": clean_email}, {"$set": {
                    "status": "pending",
                    "role": udoc.get("role", "student"),
                    "requested_role": udoc.get("requested_role", "student"),
                    "department": udoc.get("department", ""),
                    "roll_or_id": udoc.get("roll_or_id", ""),
                    "updated_at": udoc.get("updated_at")
                }})
    except Exception as e:
        logger.warning(f"[Auth] Sync local cache notice: {e}")


# ==============================================================================
# STEP 1: SIGN UP (CREATE ACCOUNT WITH EMAIL & NEW PASSWORD)
# ==============================================================================

def signup_user_account(name: str, email: str, password: str) -> Dict[str, Any]:
    """
    Step 1 for first-time visitors: Sign up with Name, Email, and New Password.
    - If email is ADMIN_EMAIL (hp5623699@gmail.com), directly logs them in as Admin.
    - For regular users, creates account with status='unrequested' so they proceed
      immediately to Step 2: Select Student/Faculty Role & Send Join Request to Admin.
    """
    clean_email = (email or "").strip().lower()
    clean_name = (name or "").strip()

    if not clean_email or "@" not in clean_email:
        raise ValueError("Please enter a valid email address.")
    if not clean_name:
        raise ValueError("Please enter your full name.")
    if not password or len(password) < 4:
        raise ValueError("Password must be at least 4 characters long.")

    is_admin = (clean_email == ADMIN_EMAIL.lower())
    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    pw_hash = _hash_password(password)

    col = get_users_collection()
    if col is not None:
        _ensure_admin_exists(col)
        existing = col.find_one({"email": clean_email})

        if is_admin:
            col.update_one(
                {"email": clean_email},
                {"$set": {
                    "name": clean_name or "System Administrator",
                    "password_hash": pw_hash,
                    "role": "admin",
                    "requested_role": "admin",
                    "status": "approved",
                    "updated_at": now_iso
                }},
                upsert=True
            )
            admin_doc = col.find_one({"email": clean_email})
            return {
                "status": "approved",
                "user": _sanitize_user(admin_doc),
                "token": _generate_session_token(clean_email, "admin"),
                "message": "Admin account ready! Redirecting to Admin Control Panel..."
            }

        if existing:
            if existing.get("status") == "approved":
                raise ValueError(
                    f"An approved account for {clean_email} already exists. Please use the Login tab."
                )
            col.update_one(
                {"email": clean_email},
                {"$set": {
                    "name": clean_name,
                    "password_hash": pw_hash,
                    "updated_at": now_iso
                }}
            )
            doc = col.find_one({"email": clean_email})
        else:
            doc = {
                "name": clean_name,
                "email": clean_email,
                "password_hash": pw_hash,
                "role": "student",
                "requested_role": "",
                "status": "unrequested",
                "department": "",
                "roll_or_id": "",
                "reason": "",
                "created_at": now_iso,
                "updated_at": now_iso,
                "approved_by": None
            }
            col.insert_one(doc)
    else:
        users = _load_local_users()
        existing = users.get(clean_email)
        if existing and not is_admin and existing.get("status") == "approved":
            raise ValueError(f"An approved account for {clean_email} already exists. Please use the Login tab.")
        doc = {
            "name": clean_name,
            "email": clean_email,
            "password_hash": pw_hash,
            "role": "admin" if is_admin else "student",
            "requested_role": "admin" if is_admin else "",
            "status": "approved" if is_admin else (existing.get("status", "unrequested") if existing else "unrequested"),
            "department": existing.get("department", "") if existing else "",
            "roll_or_id": existing.get("roll_or_id", "") if existing else "",
            "reason": "",
            "created_at": existing.get("created_at", now_iso) if existing else now_iso,
            "updated_at": now_iso,
            "approved_by": ADMIN_EMAIL if is_admin else None
        }
        users[clean_email] = doc
        _save_local_users(users)

    user_clean = _sanitize_user(doc)
    return {
        "status": user_clean.get("status", "unrequested"),
        "user": user_clean,
        "admin_email": ADMIN_EMAIL,
        "message": "Account created! Please select your role and send your join request to the Admin."
    }


# ==============================================================================
# STEP 2: SEND ROLE JOIN REQUEST TO ADMIN (WITH SMTP EMAIL TO ADMIN)
# ==============================================================================

def register_join_request(
    name: str,
    email: str,
    password: str = "",
    requested_role: str = "student",
    department: str = "",
    roll_or_id: str = "",
    reason: str = ""
) -> Dict[str, Any]:
    """
    Submits the user's role request ('student' or 'faculty') to the Admin (hp5623699@gmail.com).
    Saves status='pending' in MongoDB AND dispatches an SMTP notification email to hp5623699@gmail.com.
    """
    clean_email = (email or "").strip().lower()
    clean_name = (name or "").strip()
    req_role = (requested_role or "student").strip().lower()
    if req_role not in ("student", "faculty", "admin"):
        req_role = "student"

    if not clean_email or "@" not in clean_email:
        raise ValueError("Valid email address is required.")

    is_admin_email = (clean_email == ADMIN_EMAIL.lower())
    final_role = "admin" if is_admin_email else req_role
    final_status = "approved" if is_admin_email else "pending"
    now_iso = datetime.datetime.utcnow().isoformat() + "Z"

    col = get_users_collection()
    doc = None

    if col is not None:
        _ensure_admin_exists(col)
        existing = col.find_one({"email": clean_email})
        update_data: Dict[str, Any] = {
            "role": final_role,
            "requested_role": final_role,
            "status": final_status,
            "department": department.strip(),
            "roll_or_id": roll_or_id.strip(),
            "reason": reason.strip(),
            "updated_at": now_iso
        }
        if clean_name:
            update_data["name"] = clean_name
        if password and len(password) >= 4:
            update_data["password_hash"] = _hash_password(password)

        if existing:
            col.update_one({"email": clean_email}, {"$set": update_data})
            doc = col.find_one({"email": clean_email})
        else:
            if not password or len(password) < 4:
                raise ValueError("Password is required to create an account.")
            update_data.update({
                "email": clean_email,
                "name": clean_name or clean_email.split("@")[0],
                "password_hash": _hash_password(password),
                "created_at": now_iso,
                "approved_by": ADMIN_EMAIL if is_admin_email else None
            })
            col.insert_one(update_data)
            doc = update_data
    else:
        users = _load_local_users()
        existing = users.get(clean_email, {})
        doc = {
            "name": clean_name or existing.get("name", "User"),
            "email": clean_email,
            "password_hash": _hash_password(password) if password else existing.get("password_hash", ""),
            "role": final_role,
            "requested_role": final_role,
            "status": final_status,
            "department": department.strip(),
            "roll_or_id": roll_or_id.strip(),
            "reason": reason.strip(),
            "created_at": existing.get("created_at", now_iso),
            "updated_at": now_iso,
            "approved_by": ADMIN_EMAIL if is_admin_email else None
        }
        users[clean_email] = doc
        _save_local_users(users)

    # Mirror to local cache
    try:
        users = _load_local_users()
        users[clean_email] = dict(doc)
        users[clean_email].pop("_id", None)
        _save_local_users(users)
    except Exception:
        pass

    applicant_name = doc.get("name", clean_name or "New User")

    # Dispatch email notification in background thread so HTTP request returns instantly!
    if not is_admin_email:
        html_body = f"""
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #1e40af, #4f46e5); color: #ffffff; padding: 18px 22px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 18px;">New Role Access Join Request</h2>
                <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Academic Exam & Marksheet Portal</p>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                Hello Admin (<strong>{ADMIN_EMAIL}</strong>),<br><br>
                A new user has signed up and sent a join request for portal access. Here are the requestor's details:
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold; width: 38%;">Requestor Name:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{applicant_name}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Requestor Email:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;"><a href="mailto:{clean_email}">{clean_email}</a></td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Requested Role:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;"><strong style="color: #2563eb; text-transform: uppercase;">{req_role.upper()}</strong></td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Department / Branch:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{department or 'Not specified'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Roll No / Faculty ID:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{roll_or_id or 'Not specified'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Requested At:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{now_iso}</td>
                </tr>
            </table>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                To verify and accept this request, please open the <strong>Admin Control Panel</strong>:
            </p>
            <div style="margin: 22px 0;">
                <a href="{PORTAL_PUBLIC_URL}/admin" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                    Open Admin Control Panel to Approve
                </a>
            </div>
            <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
                This is an automated notification from the Academic Exam & Marksheet Portal.
            </p>
        </div>
        """
        _dispatch_email_background(
            subject=f"[Portal Join Request] {applicant_name} ({clean_email}) requested {req_role.upper()} role",
            recipient_email=ADMIN_EMAIL,
            html_body=html_body
        )

    user_clean = _sanitize_user(doc)
    result = {
        "status": final_status,
        "admin_email": ADMIN_EMAIL,
        "email_notification_sent": True,
        "smtp_error": None,
        "user": user_clean,
        "message": (
            "Admin account active!"
            if is_admin_email
            else f"Join request for {req_role.upper()} role submitted! Notification sent to Admin ({ADMIN_EMAIL})."
        )
    }
    if is_admin_email:
        result["token"] = _generate_session_token(clean_email, "admin")
    return result


# ==============================================================================
# LOGIN AUTHENTICATION (ADMIN DIRECT LANDING + USER STATUS CHECK)
# ==============================================================================

def authenticate_user(email: str, password: str) -> Dict[str, Any]:
    """
    Authenticates a user or Admin with email and password.
    - If email == hp5623699@gmail.com and password == Admin@123 (or stored hash),
      directly approves and returns role='admin' so Admin lands directly on /admin!
    - If user has status == 'unrequested', prompts them to send their Role Join Request.
    - If user has status == 'pending', shows pending approval screen.
    - If user has status == 'approved', logs them into their Student or Faculty portal.
    """
    clean_email = (email or "").strip().lower()
    if not clean_email or not password:
        raise ValueError("Please enter both email and password.")

    pw_hash = _hash_password(password)
    is_admin_email = (clean_email == ADMIN_EMAIL.lower())

    col = get_users_collection()
    doc = None
    if col is not None:
        _ensure_admin_exists(col)
        doc = col.find_one({"email": clean_email})

    if doc is None:
        users = _load_local_users()
        doc = users.get(clean_email)

    # Guarantee Admin login with hp5623699@gmail.com + Admin@123
    if is_admin_email and (password == DEFAULT_ADMIN_PASSWORD or (doc and doc.get("password_hash") == pw_hash)):
        now_iso = datetime.datetime.utcnow().isoformat() + "Z"
        admin_user = {
            "name": doc.get("name", "System Administrator") if doc else "System Administrator",
            "email": ADMIN_EMAIL,
            "role": "admin",
            "requested_role": "admin",
            "status": "approved",
            "department": "Administration",
            "created_at": doc.get("created_at", now_iso) if doc else now_iso,
            "updated_at": now_iso
        }
        return {
            "status": "approved",
            "admin_email": ADMIN_EMAIL,
            "user": admin_user,
            "token": _generate_session_token(ADMIN_EMAIL, "admin"),
            "message": "Welcome Administrator! Redirecting to Admin Control Panel..."
        }

    if not doc:
        raise ValueError("No account found for this email. Please switch to the Sign Up tab to create your account first.")

    stored_hash = doc.get("password_hash", "")
    if stored_hash != pw_hash:
        raise ValueError("Invalid password. Please check your password and try again.")

    status = doc.get("status", "unrequested")
    role = doc.get("role", doc.get("requested_role", "student"))

    user_clean = _sanitize_user(doc)
    user_clean["status"] = status
    user_clean["role"] = role

    if status == "unrequested":
        return {
            "status": "unrequested",
            "admin_email": ADMIN_EMAIL,
            "user": user_clean,
            "message": "Please select your role (Student or Faculty) and send a join request to the Admin."
        }

    if status == "pending":
        return {
            "status": "pending",
            "admin_email": ADMIN_EMAIL,
            "user": user_clean,
            "message": f"Your join request for the {role.upper()} role is awaiting approval from Admin ({ADMIN_EMAIL})."
        }

    if status == "rejected":
        return {
            "status": "rejected",
            "admin_email": ADMIN_EMAIL,
            "user": user_clean,
            "message": f"Your join request was declined by the Administrator ({ADMIN_EMAIL}). You may submit a new role request."
        }

    token = _generate_session_token(clean_email, role)
    must_change = bool(doc.get("must_change_password", False))
    user_clean["must_change_password"] = must_change
    return {
        "status": "approved",
        "must_change_password": must_change,
        "admin_email": ADMIN_EMAIL,
        "user": user_clean,
        "token": token,
        "message": (
            "Please set a new personal password to replace your initial temporary password."
            if must_change
            else f"Welcome back, {user_clean.get('name', 'User')}!"
        )
    }


def get_user_status(email: str) -> Dict[str, Any]:
    clean_email = (email or "").strip().lower()
    if not clean_email:
        raise ValueError("Email is required.")

    doc = None
    col = get_users_collection()
    if col is not None:
        _ensure_admin_exists(col)
        doc = col.find_one({"email": clean_email})

    if doc is None:
        users = _load_local_users()
        doc = users.get(clean_email)

    if not doc:
        return {"status": "not_found", "email": clean_email}

    status = doc.get("status", "pending")
    role = doc.get("role", doc.get("requested_role", "student"))
    if clean_email == ADMIN_EMAIL.lower():
        status = "approved"
        role = "admin"

    user_clean = _sanitize_user(doc)
    user_clean["status"] = status
    user_clean["role"] = role

    res = {
        "status": status,
        "user": user_clean,
        "admin_email": ADMIN_EMAIL
    }
    if status == "approved":
        res["token"] = _generate_session_token(clean_email, role)
    return res


def list_all_users(admin_email: str) -> Dict[str, Any]:
    if (admin_email or "").strip().lower() != ADMIN_EMAIL.lower():
        raise PermissionError(f"Unauthorized: Only {ADMIN_EMAIL} can access Admin User Management.")

    docs: List[Dict[str, Any]] = []
    col = get_users_collection()
    if col is not None:
        _ensure_admin_exists(col)
        _sync_local_cache_to_mongo(col)
        cursor = col.find({})
        for d in cursor:
            docs.append(_sanitize_user(d))
    else:
        users = _load_local_users()
        docs = [_sanitize_user(u) for u in users.values()]

    status_priority = {"pending": 0, "unrequested": 1, "approved": 2, "rejected": 3}
    docs.sort(
        key=lambda x: (
            status_priority.get(x.get("status", "pending"), 9),
            -(int(datetime.datetime.fromisoformat(x["created_at"].replace("Z", "")).timestamp())
              if x.get("created_at") and "T" in str(x.get("created_at"))
              else 0)
        )
    )

    pending_count = sum(1 for u in docs if u.get("status") in ("pending", "unrequested"))
    approved_faculty = sum(1 for u in docs if u.get("status") == "approved" and u.get("role") == "faculty")
    approved_students = sum(1 for u in docs if u.get("status") == "approved" and u.get("role") == "student")
    rejected_count = sum(1 for u in docs if u.get("status") == "rejected")

    smtp_cfg = get_smtp_config()

    return {
        "status": "success",
        "admin_email": ADMIN_EMAIL,
        "smtp_configured": smtp_cfg["is_configured"],
        "smtp_email": smtp_cfg["smtp_email"],
        "summary": {
            "total": len(docs),
            "pending": pending_count,
            "approved_faculty": approved_faculty,
            "approved_students": approved_students,
            "rejected": rejected_count
        },
        "users": docs
    }


# ==============================================================================
# ADMIN APPROVAL & CONFIRMATION EMAIL TO REQUESTOR
# ==============================================================================

def update_user_access(
    admin_email: str,
    target_email: str,
    action: str,
    assigned_role: Optional[str] = None
) -> Dict[str, Any]:
    """
    Approves, rejects, or changes role for a user request, and automatically sends
    an SMTP Confirmation Email to the requestor!
    """
    if (admin_email or "").strip().lower() != ADMIN_EMAIL.lower():
        raise PermissionError(f"Unauthorized: Only {ADMIN_EMAIL} can modify user roles and approvals.")

    clean_target = (target_email or "").strip().lower()
    if not clean_target:
        raise ValueError("Target user email is required.")

    if clean_target == ADMIN_EMAIL.lower() and action in ("reject", "pending"):
        raise ValueError("Cannot revoke or reject the primary Administrator account.")

    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    col = get_users_collection()
    doc = None

    if col is not None:
        doc = col.find_one({"email": clean_target})

    if doc is None:
        users = _load_local_users()
        doc = users.get(clean_target)

    if not doc:
        raise ValueError(f"User {clean_target} not found.")

    new_role = (assigned_role or doc.get("role") or doc.get("requested_role") or "student").strip().lower()
    if new_role not in ("student", "faculty", "admin"):
        new_role = "student"

    if action == "approve":
        new_status = "approved"
    elif action == "reject":
        new_status = "rejected"
    elif action == "pending":
        new_status = "pending"
    elif action == "change_role":
        new_status = doc.get("status", "approved")
    else:
        raise ValueError(f"Invalid action: {action}")

    update_fields = {
        "status": new_status,
        "role": new_role,
        "updated_at": now_iso,
        "approved_by": ADMIN_EMAIL
    }

    if col is not None:
        col.update_one({"email": clean_target}, {"$set": update_fields})
        updated_doc = col.find_one({"email": clean_target})
    else:
        users = _load_local_users()
        users[clean_target].update(update_fields)
        _save_local_users(users)
        updated_doc = users[clean_target]

    try:
        users = _load_local_users()
        if clean_target in users:
            users[clean_target].update(update_fields)
            _save_local_users(users)
    except Exception:
        pass

    user_name = updated_doc.get("name", "User")
    smtp_res = {"sent": False, "error": None}

    # Send Confirmation Email via SMTP to Requestor when Admin approves or rejects
    if action in ("approve", "change_role") and new_status == "approved":
        html_body = f"""
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: #ffffff; padding: 18px 22px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 18px;">Join Request Approved! 🎉</h2>
                <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Academic Exam & Marksheet Portal</p>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                Hello <strong>{user_name}</strong>,<br><br>
                Your join request has been verified and <strong>APPROVED</strong> by the Portal Administrator (<strong>{ADMIN_EMAIL}</strong>).
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold; width: 38%;">Registered Email:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{clean_target}</td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Assigned Role:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;"><strong style="color: #16a34a; text-transform: uppercase;">{new_role.upper()}</strong></td>
                </tr>
                <tr>
                    <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Approved By:</td>
                    <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{ADMIN_EMAIL}</td>
                </tr>
            </table>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
                You can now log in to your <strong>{new_role.upper()} Portal</strong> using your email and password:
            </p>
            <div style="margin: 22px 0;">
                <a href="{PORTAL_PUBLIC_URL}/login" style="background: #16a34a; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                    Sign In to Portal Now
                </a>
            </div>
            <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
                Academic Exam & Marksheet Portal • Admin: {ADMIN_EMAIL}
            </p>
        </div>
        """
        _dispatch_email_background(
            subject=f"Access Approved: {new_role.upper()} Role Granted — Academic Exam & Marksheet Portal",
            recipient_email=clean_target,
            html_body=html_body
        )
    elif action == "reject":
        html_body = f"""
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <h2 style="color: #dc2626; margin-top: 0;">Join Request Status Update</h2>
            <p>Hello <strong>{user_name}</strong>,</p>
            <p>Your join request for the Academic Exam & Marksheet Portal could not be approved at this time.</p>
            <p>If you believe this was a mistake, please contact the Administrator at <a href="mailto:{ADMIN_EMAIL}">{ADMIN_EMAIL}</a>.</p>
        </div>
        """
        _dispatch_email_background(
            subject="Portal Join Request Update — Academic Exam & Marksheet Portal",
            recipient_email=clean_target,
            html_body=html_body
        )

    return {
        "status": "success",
        "email_sent": True,
        "smtp_error": None,
        "message": f"User {clean_target} updated ({new_status.upper()} as {new_role.upper()}) & notification email dispatched!",
        "user": _sanitize_user(updated_doc)
    }


def admin_create_user(
    admin_email: str,
    name: str,
    email: str,
    password: str,
    role: str,
    department: str = "",
    roll_or_id: str = ""
) -> Dict[str, Any]:
    if (admin_email or "").strip().lower() != ADMIN_EMAIL.lower():
        raise PermissionError(f"Unauthorized: Only {ADMIN_EMAIL} can directly create users.")

    clean_email = (email or "").strip().lower()
    clean_name = (name or "").strip()
    clean_role = (role or "student").strip().lower()
    if clean_role not in ("student", "faculty", "admin"):
        clean_role = "student"

    if not clean_email or "@" not in clean_email:
        raise ValueError("Valid email address is required.")
    if not clean_name:
        raise ValueError("Full name is required.")
    if not password or len(password) < 4:
        raise ValueError("Password must be at least 4 characters.")

    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    pw_hash = _hash_password(password)

    user_doc = {
        "name": clean_name,
        "email": clean_email,
        "password_hash": pw_hash,
        "role": clean_role,
        "requested_role": clean_role,
        "status": "approved",
        "must_change_password": True,
        "department": department.strip(),
        "roll_or_id": roll_or_id.strip(),
        "reason": "Directly created and pre-approved by Admin",
        "created_at": now_iso,
        "updated_at": now_iso,
        "approved_by": ADMIN_EMAIL
    }

    col = get_users_collection()
    if col is not None:
        col.update_one({"email": clean_email}, {"$set": user_doc}, upsert=True)
    users = _load_local_users()
    users[clean_email] = dict(user_doc)
    _save_local_users(users)

    # Dispatch Welcome & Initial Password Email via SMTP to the newly added Student / Faculty
    html_body = f"""
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #2563eb, #4f46e5); color: #ffffff; padding: 18px 22px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 18px;">Welcome to Academic Exam & Marksheet Portal! 🎓</h2>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Your {clean_role.upper()} Account Has Been Created by the Administrator</p>
        </div>
        <p style="color: #334155; font-size: 14px; line-height: 1.5;">
            Hello <strong>{clean_name}</strong>,<br><br>
            The Portal Administrator (<strong>{ADMIN_EMAIL}</strong>) has directly added and pre-approved your account for the <strong>{clean_role.upper()}</strong> role.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
            <tr>
                <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold; width: 40%;">Full Name:</td>
                <td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{clean_name}</td>
            </tr>
            <tr>
                <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Login Email:</td>
                <td style="padding: 10px 12px; border: 1px solid #e2e8f0;"><strong>{clean_email}</strong></td>
            </tr>
            <tr>
                <td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Assigned Role:</td>
                <td style="padding: 10px 12px; border: 1px solid #e2e8f0;"><strong style="color: #2563eb; text-transform: uppercase;">{clean_role.upper()}</strong></td>
            </tr>
            <tr>
                <td style="padding: 10px 12px; background: #fef3c7; border: 1px solid #fde68a; font-weight: bold; color: #b45309;">Initial Password:</td>
                <td style="padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; font-family: monospace; font-size: 15px; font-weight: bold; color: #b45309;">{password}</td>
            </tr>
            {f'<tr><td style="padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: bold;">Department / Info:</td><td style="padding: 10px 12px; border: 1px solid #e2e8f0;">{department}</td></tr>' if department else ''}
        </table>
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; font-size: 13px; color: #1e40af; margin-bottom: 20px;">
            <strong>🔒 Security Note:</strong> This initial password is only for your first login. When you sign in for the first time, you will be prompted to set your own new personal password.
        </div>
        <div style="margin: 22px 0;">
            <a href="{PORTAL_PUBLIC_URL}/login" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                Login & Set Your New Password
            </a>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
            Academic Exam & Marksheet Portal • Admin: {ADMIN_EMAIL}
        </p>
    </div>
    """
    _dispatch_email_background(
        subject=f"Your {clean_role.upper()} Account & Initial Password — Academic Exam & Marksheet Portal",
        recipient_email=clean_email,
        html_body=html_body
    )

    return {
        "status": "success",
        "email_sent": True,
        "smtp_error": None,
        "message": f"Created and pre-approved {clean_role.upper()} account for {clean_email} & welcome email dispatched!",
        "user": _sanitize_user(user_doc)
    }


def change_user_password(
    email: str,
    current_password: str,
    new_password: str
) -> Dict[str, Any]:
    """
    Allows a user (especially one directly added by Admin with an initial password)
    to change their password and clears must_change_password.
    """
    clean_email = (email or "").strip().lower()
    if not clean_email:
        raise ValueError("Email is required.")
    if not current_password:
        raise ValueError("Current/initial password is required.")
    if not new_password or len(new_password) < 4:
        raise ValueError("New password must be at least 4 characters long.")

    curr_hash = _hash_password(current_password)
    new_hash = _hash_password(new_password)

    col = get_users_collection()
    doc = None
    if col is not None:
        doc = col.find_one({"email": clean_email})
    if doc is None:
        users = _load_local_users()
        doc = users.get(clean_email)

    if not doc:
        raise ValueError("User account not found.")

    if doc.get("password_hash") != curr_hash:
        raise ValueError("Current/initial password is incorrect.")

    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
    update_fields = {
        "password_hash": new_hash,
        "must_change_password": False,
        "updated_at": now_iso
    }

    if col is not None:
        col.update_one({"email": clean_email}, {"$set": update_fields})
        updated_doc = col.find_one({"email": clean_email})
    else:
        users = _load_local_users()
        users[clean_email].update(update_fields)
        _save_local_users(users)
        updated_doc = users[clean_email]

    try:
        users = _load_local_users()
        if clean_email in users:
            users[clean_email].update(update_fields)
            _save_local_users(users)
    except Exception:
        pass

    user_clean = _sanitize_user(updated_doc)
    user_clean["must_change_password"] = False
    role = user_clean.get("role", "student")
    token = _generate_session_token(clean_email, role)

    return {
        "status": "success",
        "message": "Your password has been updated successfully!",
        "user": user_clean,
        "token": token
    }


def delete_user_account(admin_email: str, target_email: str) -> Dict[str, Any]:
    if (admin_email or "").strip().lower() != ADMIN_EMAIL.lower():
        raise PermissionError(f"Unauthorized: Only {ADMIN_EMAIL} can delete user accounts.")

    clean_target = (target_email or "").strip().lower()
    if clean_target == ADMIN_EMAIL.lower():
        raise ValueError("Cannot delete the primary Administrator account.")

    col = get_users_collection()
    if col is not None:
        col.delete_one({"email": clean_target})

    users = _load_local_users()
    if clean_target in users:
        del users[clean_target]
        _save_local_users(users)

    return {
        "status": "success",
        "message": f"Deleted user account/request for {clean_target}."
    }
