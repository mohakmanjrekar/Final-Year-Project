/**
 * Academic Exam Marksheet & Grade Portal App.
 * Handles Dual Portal (Student Upload & Faculty Dashboard),
 * MongoDB Classroom Management, AI Number Extraction, and Master Grade Sheet Export.
 */

document.addEventListener('DOMContentLoaded', () => {
    const spreadsheetEditor = new SpreadsheetEditorController(
        'sectionTabsBar',
        'tableHead',
        'tableBody'
    );

    // Current File & State
    let currentUploadedData = null;
    let originalImgWidth = 1204;
    let originalImgHeight = 1600;
    let currentCropRect = null;
    let isAutoCropped = false;
    let activeClassroomsList = [];
    let currentRosterData = [];

    // Navigation Tabs
    const tabStudentPortal = document.getElementById('tabStudentPortal');
    const tabFacultyPortal = document.getElementById('tabFacultyPortal');
    const studentPortalView = document.getElementById('studentPortalView');
    const facultyPortalView = document.getElementById('facultyPortalView');

    // Student View Elements
    const studentClassroomSelect = document.getElementById('studentClassroomSelect');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const cameraInput = document.getElementById('cameraInput');
    const btnSnapCamera = document.getElementById('btnSnapCamera');
    const btnChooseFile = document.getElementById('btnChooseFile');
    const filePreviewBar = document.getElementById('filePreviewBar');
    const lblFileName = document.getElementById('lblFileName');
    const lblFileMeta = document.getElementById('lblFileMeta');
    const btnChangeFile = document.getElementById('btnChangeFile');

    const cropControlStrip = document.getElementById('cropControlStrip');
    const btnAutoCrop = document.getElementById('btnAutoCrop');
    const btnManualCrop = document.getElementById('btnManualCrop');
    const btnClearCrop = document.getElementById('btnClearCrop');

    const pageCropPreviewCard = document.getElementById('pageCropPreviewCard');
    const cropBadge = document.getElementById('cropBadge');
    const cropStage = document.getElementById('cropStage');
    const previewImage = document.getElementById('previewImage');
    const cropBox = document.getElementById('cropBox');

    const btnConvert = document.getElementById('btnConvert');
    const resultCard = document.getElementById('resultCard');

    const btnSubmitToDb = document.getElementById('btnSubmitToDb');
    const btnExportExcel = document.getElementById('btnExportExcel');
    const btnExportCsv = document.getElementById('btnExportCsv');

    const btnAddRow = document.getElementById('btnAddRow');
    const btnAddCol = document.getElementById('btnAddCol');
    const btnClearGrid = document.getElementById('btnClearGrid');

    // Faculty View Elements
    const facultyClassroomSelect = document.getElementById('facultyClassroomSelect');
    const facultySubmissionToggle = document.getElementById('facultySubmissionToggle');
    const facultySubmissionStatusLabel = document.getElementById('facultySubmissionStatusLabel');
    const studentSubmissionStatusBadge = document.getElementById('studentSubmissionStatusBadge');
    const studentSubmissionLockBanner = document.getElementById('studentSubmissionLockBanner');
    const btnOpenCreateClassModal = document.getElementById('btnOpenCreateClassModal');
    const btnRefreshFacultyRoster = document.getElementById('btnRefreshFacultyRoster');
    const btnFacultyExportExcel = document.getElementById('btnFacultyExportExcel');
    const btnFacultyExportCsv = document.getElementById('btnFacultyExportCsv');

    const statTotalSubmissions = document.getElementById('statTotalSubmissions');
    const statClassAverage = document.getElementById('statClassAverage');
    const statHighestScore = document.getElementById('statHighestScore');
    const statTopStudent = document.getElementById('statTopStudent');
    const statLatestTime = document.getElementById('statLatestTime');
    const statLatestStudent = document.getElementById('statLatestStudent');

    const facultyRosterSearch = document.getElementById('facultyRosterSearch');
    const facultyRosterTableBody = document.getElementById('facultyRosterTableBody');
    const rosterEmptyState = document.getElementById('rosterEmptyState');

    // Modal & Toast Elements
    const createClassModal = document.getElementById('createClassModal');
    const btnCloseCreateClassModal = document.getElementById('btnCloseCreateClassModal');
    const btnCancelCreateClass = document.getElementById('btnCancelCreateClass');
    const createClassForm = document.getElementById('createClassForm');
    const toastNotification = document.getElementById('toastNotification');
    const toastTitle = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');

    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingMessage = document.getElementById('loadingMessage');

    const FACULTY_PASSCODE = 'faculty@123';
    const modalFacultyAuth = document.getElementById('modalFacultyAuth');
    const formFacultyAuth = document.getElementById('formFacultyAuth');
    const facultyPasscodeInput = document.getElementById('facultyPasscodeInput');
    const facultyPasscodeError = document.getElementById('facultyPasscodeError');
    const btnCancelFacultyAuth = document.getElementById('btnCancelFacultyAuth');
    const btnTogglePasscodeVisibility = document.getElementById('btnTogglePasscodeVisibility');
    const iconPasscodeEye = document.getElementById('iconPasscodeEye');
    const btnLockFacultySession = document.getElementById('btnLockFacultySession');

    // ------------------------------------------------------------------
    // 1. Role-Based Access Control (Student / Faculty / Admin)
    // ------------------------------------------------------------------
    const AUTH_STORAGE_KEY = 'portal_auth_session_v1';
    const ADMIN_EMAIL = 'hp5623699@gmail.com';
    const navUserName = document.getElementById('navUserName');
    const navUserRoleBadge = document.getElementById('navUserRoleBadge');
    const btnNavAdminPanel = document.getElementById('btnNavAdminPanel');
    const btnNavLogout = document.getElementById('btnNavLogout');

    let currentLoggedUser = null;

    function getStoredSessionUser() {
        try {
            const raw = localStorage.getItem(AUTH_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && parsed.user ? parsed.user : null;
        } catch (e) {
            return null;
        }
    }

    function switchPortal(portal) {
        const userRole = currentLoggedUser ? (currentLoggedUser.role || 'student').toLowerCase() : 'student';

        // Enforce strict role separation
        if (userRole === 'student' && portal !== 'student') {
            portal = 'student';
        } else if (userRole === 'faculty' && portal !== 'faculty') {
            portal = 'faculty';
        }

        if (portal === 'student') {
            if (tabStudentPortal) tabStudentPortal.classList.add('active');
            if (tabFacultyPortal) tabFacultyPortal.classList.remove('active');
            if (studentPortalView) studentPortalView.style.display = 'block';
            if (facultyPortalView) facultyPortalView.style.display = 'none';
        } else {
            if (tabFacultyPortal) tabFacultyPortal.classList.add('active');
            if (tabStudentPortal) tabStudentPortal.classList.remove('active');
            if (studentPortalView) studentPortalView.style.display = 'none';
            if (facultyPortalView) facultyPortalView.style.display = 'block';
            loadFacultyRoster();
        }
    }

    function applyUserRolePermissions(user) {
        if (!user || !user.email) {
            window.location.replace('/login');
            return;
        }
        currentLoggedUser = user;
        const role = (user.email.toLowerCase() === ADMIN_EMAIL) ? 'admin' : (user.role || 'student').toLowerCase();
        currentLoggedUser.role = role;

        if (navUserName) navUserName.innerText = user.name || user.email;
        if (navUserRoleBadge) {
            navUserRoleBadge.innerText = role.toUpperCase();
            if (role === 'admin') navUserRoleBadge.style.color = '#7e22ce';
            else if (role === 'faculty') navUserRoleBadge.style.color = '#4338ca';
            else navUserRoleBadge.style.color = '#15803d';
        }

        const urlParams = new URLSearchParams(window.location.search);
        const requestedView = urlParams.get('view');

        if (role === 'student') {
            // Strict Student View: only Student Portal
            if (tabStudentPortal) tabStudentPortal.style.display = 'inline-flex';
            if (tabFacultyPortal) tabFacultyPortal.style.display = 'none';
            if (btnNavAdminPanel) btnNavAdminPanel.style.display = 'none';
            switchPortal('student');
        } else if (role === 'faculty') {
            // Strict Faculty View: only Faculty Dashboard
            if (tabStudentPortal) tabStudentPortal.style.display = 'none';
            if (tabFacultyPortal) tabFacultyPortal.style.display = 'inline-flex';
            if (btnNavAdminPanel) btnNavAdminPanel.style.display = 'none';
            if (btnLockFacultySession) btnLockFacultySession.style.display = 'none';
            switchPortal('faculty');
        } else if (role === 'admin') {
            // Admin View: full access to Admin Panel + Student Portal + Faculty Dashboard
            if (tabStudentPortal) tabStudentPortal.style.display = 'inline-flex';
            if (tabFacultyPortal) tabFacultyPortal.style.display = 'inline-flex';
            if (btnNavAdminPanel) btnNavAdminPanel.style.display = 'inline-flex';
            if (btnLockFacultySession) btnLockFacultySession.style.display = 'none';
            if (requestedView === 'faculty') {
                switchPortal('faculty');
            } else {
                switchPortal('student');
            }
        }
    }

    if (tabStudentPortal) tabStudentPortal.addEventListener('click', () => switchPortal('student'));
    if (tabFacultyPortal) tabFacultyPortal.addEventListener('click', () => switchPortal('faculty'));

    if (btnNavLogout) {
        btnNavLogout.addEventListener('click', () => {
            localStorage.removeItem(AUTH_STORAGE_KEY);
            sessionStorage.removeItem('faculty_unlocked');
            window.location.href = '/login?logout=1';
        });
    }

    if (btnLockFacultySession) {
        btnLockFacultySession.addEventListener('click', () => {
            localStorage.removeItem(AUTH_STORAGE_KEY);
            window.location.href = '/login?logout=1';
        });
    }

    // Initialize role permissions from local session and verify live with server
    (async function initPortalSession() {
        const storedUser = getStoredSessionUser();
        if (!storedUser) {
            window.location.replace('/login');
            return;
        }
        applyUserRolePermissions(storedUser);

        try {
            const res = await fetch(`/api/auth/status?email=${encodeURIComponent(storedUser.email)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'approved' && data.user) {
                    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
                        user: data.user,
                        token: data.token || '',
                        logged_in_at: new Date().toISOString()
                    }));
                    applyUserRolePermissions(data.user);
                } else {
                    localStorage.removeItem(AUTH_STORAGE_KEY);
                    window.location.replace('/login');
                }
            }
        } catch (err) {
            console.warn('Offline session check:', err);
        }
    })();

    // ------------------------------------------------------------------
    // 2. Classroom Management (MongoDB Synced)
    // ------------------------------------------------------------------
    async function loadClassrooms(selectedIdToSet = null) {
        try {
            const res = await fetch('/api/classrooms');
            const data = await res.json();

            if (data.status === 'success' && data.classrooms) {
                activeClassroomsList = data.classrooms;
            } else {
                activeClassroomsList = [];
            }

            populateClassroomDropdowns(selectedIdToSet);
        } catch (err) {
            console.error('Failed to load classrooms from MongoDB:', err);
        }
    }

    function updateStudentLockState(classroomId) {
        if (!classroomId || !activeClassroomsList || activeClassroomsList.length === 0) return;
        const cls = activeClassroomsList.find(c => c.classroom_id === classroomId);
        const isOpen = cls ? (cls.is_submission_open !== false) : true;

        if (isOpen) {
            if (studentSubmissionStatusBadge) {
                studentSubmissionStatusBadge.className = 'submission-status-badge status-open';
                studentSubmissionStatusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Submissions Open';
            }
            if (studentSubmissionLockBanner) studentSubmissionLockBanner.style.display = 'none';

            if (dropZone) dropZone.style.pointerEvents = 'auto';
            if (dropZone) dropZone.style.opacity = '1';
            if (btnSnapCamera) btnSnapCamera.disabled = false;
            if (btnChooseFile) btnChooseFile.disabled = false;
            if (btnSubmitToDb) btnSubmitToDb.disabled = false;
        } else {
            if (studentSubmissionStatusBadge) {
                studentSubmissionStatusBadge.className = 'submission-status-badge status-closed';
                studentSubmissionStatusBadge.innerHTML = '<i class="fa-solid fa-lock"></i> Submissions Locked';
            }
            if (studentSubmissionLockBanner) studentSubmissionLockBanner.style.display = 'flex';

            if (dropZone) dropZone.style.pointerEvents = 'none';
            if (dropZone) dropZone.style.opacity = '0.5';
            if (btnSnapCamera) btnSnapCamera.disabled = true;
            if (btnChooseFile) btnChooseFile.disabled = true;
            if (btnSubmitToDb) btnSubmitToDb.disabled = true;
        }
    }

    function updateFacultyToggleState(classroomId) {
        if (!classroomId || !activeClassroomsList || activeClassroomsList.length === 0) return;
        const cls = activeClassroomsList.find(c => c.classroom_id === classroomId);
        const isOpen = cls ? (cls.is_submission_open !== false) : true;

        if (facultySubmissionToggle) {
            facultySubmissionToggle.checked = isOpen;
        }
        if (facultySubmissionStatusLabel) {
            if (isOpen) {
                facultySubmissionStatusLabel.className = 'faculty-toggle-status status-open';
                facultySubmissionStatusLabel.innerHTML = '<i class="fa-solid fa-lock-open"></i> Submissions OPEN';
            } else {
                facultySubmissionStatusLabel.className = 'faculty-toggle-status status-closed';
                facultySubmissionStatusLabel.innerHTML = '<i class="fa-solid fa-lock"></i> Submissions LOCKED';
            }
        }
    }

    function populateClassroomDropdowns(selectedId = null) {
        if (!activeClassroomsList || activeClassroomsList.length === 0) {
            const studentEmptyOpt = '<option value="">-- No Active Classes (Please wait for faculty) --</option>';
            const facultyEmptyOpt = '<option value="">-- No Classes Created Yet (Click "+ Create New Class / Exam" above) --</option>';
            if (studentClassroomSelect) studentClassroomSelect.innerHTML = studentEmptyOpt;
            if (facultyClassroomSelect) facultyClassroomSelect.innerHTML = facultyEmptyOpt;
            const facultyUploadClassroomSelect = document.getElementById('facultyUploadClassroomSelect');
            if (facultyUploadClassroomSelect) facultyUploadClassroomSelect.innerHTML = facultyEmptyOpt;
            return;
        }

        const studentOpts = [];
        const facultyOpts = [];

        activeClassroomsList.forEach(cls => {
            const statusTag = cls.is_submission_open === false ? ' [LOCKED]' : '';
            const label = `${cls.year} ${cls.branch} (Div ${cls.division}) • ${cls.subject} (Sem ${cls.semester}) • ${cls.exam_name || 'IA-1'}${statusTag}`;
            studentOpts.push(`<option value="${cls.classroom_id}">${label}</option>`);
            facultyOpts.push(`<option value="${cls.classroom_id}">${label}</option>`);
        });

        if (studentClassroomSelect) studentClassroomSelect.innerHTML = studentOpts.join('');
        if (facultyClassroomSelect) facultyClassroomSelect.innerHTML = facultyOpts.join('');
        const facultyUploadClassroomSelect = document.getElementById('facultyUploadClassroomSelect');
        if (facultyUploadClassroomSelect) facultyUploadClassroomSelect.innerHTML = facultyOpts.join('');

        if (selectedId) {
            if (studentClassroomSelect) studentClassroomSelect.value = selectedId;
            if (facultyClassroomSelect) facultyClassroomSelect.value = selectedId;
            if (facultyUploadClassroomSelect) facultyUploadClassroomSelect.value = selectedId;
        }

        const activeStudentId = studentClassroomSelect ? studentClassroomSelect.value : null;
        const activeFacultyId = facultyClassroomSelect ? facultyClassroomSelect.value : null;
        updateStudentLockState(activeStudentId);
        updateFacultyToggleState(activeFacultyId);
    }

    // Modal Open/Close Controls (Faculty Only)
    function openCreateClassModal() {
        createClassModal.style.display = 'flex';
    }

    function closeCreateClassModal() {
        createClassModal.style.display = 'none';
        createClassForm.reset();
    }

    if (btnOpenCreateClassModal) btnOpenCreateClassModal.addEventListener('click', openCreateClassModal);
    if (btnCloseCreateClassModal) btnCloseCreateClassModal.addEventListener('click', closeCreateClassModal);
    if (btnCancelCreateClass) btnCancelCreateClass.addEventListener('click', closeCreateClassModal);

    createClassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const year = document.getElementById('newClassYear').value.trim();
        const branch = document.getElementById('newClassBranch').value.trim();
        const division = document.getElementById('newClassDivision').value.trim();
        const semester = document.getElementById('newClassSemester').value.trim();
        const subject = document.getElementById('newClassSubject').value.trim();
        const examName = document.getElementById('newClassExam').value.trim();

        showLoading('Registering Classroom...', 'Saving new batch to MongoDB Atlas...');

        try {
            const res = await fetch('/api/classrooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: year,
                    branch: branch,
                    division: division,
                    semester: semester,
                    subject: subject,
                    exam_name: examName
                })
            });

            const data = await res.json();
            hideLoading();

            if (data.status === 'success') {
                closeCreateClassModal();
                showToast('Classroom Created!', `${year} ${branch} (${subject}) registered in MongoDB.`);
                await loadClassrooms(data.classroom.classroom_id);
                if (facultyPortalView.style.display !== 'none') {
                    loadFacultyRoster();
                }
            } else {
                alert(`Error creating classroom: ${data.detail}`);
            }
        } catch (err) {
            hideLoading();
            alert(`Failed to create classroom: ${err.message}`);
        }
    });

    // ------------------------------------------------------------------
    // 3. File Upload & Setup (Mobile Camera & Desktop)
    // ------------------------------------------------------------------
    let stageRect = { width: 1, height: 1 };
    let cropPos = { left: 0, top: 0, width: 0, height: 0 };
    let isDragging = false;
    let isResizing = false;
    let currentHandle = null;
    let startMousePos = { x: 0, y: 0 };
    let startCropPos = { left: 0, top: 0, width: 0, height: 0 };

    function initCropOverlay() {
        if (!cropStage) return;
        stageRect = cropStage.getBoundingClientRect();
        const defaultW = stageRect.width * 0.85;
        const defaultH = stageRect.height * 0.25;
        const defaultL = (stageRect.width - defaultW) / 2;
        const defaultT = (stageRect.height - defaultH) / 3;
        setCropPosPx(defaultL, defaultT, defaultW, defaultH);
    }

    function setCropPosPx(left, top, width, height) {
        if (!cropStage || !cropBox) return;
        stageRect = cropStage.getBoundingClientRect();
        if (stageRect.width === 0 || stageRect.height === 0) return;

        left = Math.max(0, Math.min(left, stageRect.width - 20));
        top = Math.max(0, Math.min(top, stageRect.height - 20));
        width = Math.max(20, Math.min(width, stageRect.width - left));
        height = Math.max(20, Math.min(height, stageRect.height - top));

        cropPos = { left, top, width, height };

        cropBox.style.left = `${left}px`;
        cropBox.style.top = `${top}px`;
        cropBox.style.width = `${width}px`;
        cropBox.style.height = `${height}px`;

        const scaleX = originalImgWidth / stageRect.width;
        const scaleY = originalImgHeight / stageRect.height;

        const origX = Math.round(left * scaleX);
        const origY = Math.round(top * scaleY);
        const origW = Math.round(width * scaleX);
        const origH = Math.round(height * scaleY);

        currentCropRect = { x: origX, y: origY, width: origW, height: origH };

        if (cropBadge) {
            const modePrefix = isAutoCropped ? 'Auto crop:' : 'Manual crop:';
            cropBadge.innerText = `${modePrefix} ${origW} × ${origH}`;
        }
    }

    function setActiveCropButton(activeBtn) {
        [btnAutoCrop, btnManualCrop, btnClearCrop].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });
        if (activeBtn) activeBtn.classList.add('active');
    }

    async function triggerAutoCrop() {
        if (!currentUploadedData || !currentUploadedData.image_b64) return;
        setActiveCropButton(btnAutoCrop);

        try {
            const res = await fetch('/api/autocrop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_b64: currentUploadedData.image_b64 })
            });

            const data = await res.json();
            if (data.status === 'success' && data.crop) {
                isAutoCropped = true;
                const crop = data.crop;
                stageRect = cropStage.getBoundingClientRect();
                const scaleX = stageRect.width / originalImgWidth;
                const scaleY = stageRect.height / originalImgHeight;

                setCropPosPx(
                    crop.x * scaleX,
                    crop.y * scaleY,
                    crop.width * scaleX,
                    crop.height * scaleY
                );
            }
        } catch (err) {
            console.warn("Auto crop request failed, using manual crop box.", err);
        }
    }

    if (btnAutoCrop) {
        btnAutoCrop.addEventListener('click', () => triggerAutoCrop());
    }

    if (btnManualCrop) {
        btnManualCrop.addEventListener('click', () => {
            isAutoCropped = false;
            setActiveCropButton(btnManualCrop);
            if (currentCropRect && cropBadge) {
                cropBadge.innerText = `Manual crop: ${currentCropRect.width} × ${currentCropRect.height}`;
            }
        });
    }

    if (btnClearCrop) {
        btnClearCrop.addEventListener('click', () => {
            isAutoCropped = false;
            setActiveCropButton(btnClearCrop);
            if (cropStage) {
                stageRect = cropStage.getBoundingClientRect();
                setCropPosPx(0, 0, stageRect.width, stageRect.height);
                if (cropBadge) cropBadge.innerText = `Full page: ${originalImgWidth} × ${originalImgHeight}`;
            }
        });
    }

    // Crop box mouse drag & resize listeners
    if (cropBox) {
        cropBox.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('crop-handle')) {
                isResizing = true;
                currentHandle = e.target.getAttribute('data-handle');
            } else {
                isDragging = true;
            }

            isAutoCropped = false;
            setActiveCropButton(btnManualCrop);

            startMousePos = { x: e.clientX, y: e.clientY };
            startCropPos = { ...cropPos };
            e.stopPropagation();
            e.preventDefault();
        });

        // Touch support
        cropBox.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            if (e.target.classList.contains('crop-handle')) {
                isResizing = true;
                currentHandle = e.target.getAttribute('data-handle');
            } else {
                isDragging = true;
            }

            isAutoCropped = false;
            setActiveCropButton(btnManualCrop);

            startMousePos = { x: touch.clientX, y: touch.clientY };
            startCropPos = { ...cropPos };
            e.stopPropagation();
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isDragging && !isResizing) return;

        const dx = e.clientX - startMousePos.x;
        const dy = e.clientY - startMousePos.y;

        if (isDragging) {
            setCropPosPx(
                startCropPos.left + dx,
                startCropPos.top + dy,
                startCropPos.width,
                startCropPos.height
            );
        } else if (isResizing && currentHandle) {
            let nL = startCropPos.left;
            let nT = startCropPos.top;
            let nW = startCropPos.width;
            let nH = startCropPos.height;

            if (currentHandle.includes('e')) nW = startCropPos.width + dx;
            if (currentHandle.includes('s')) nH = startCropPos.height + dy;
            if (currentHandle.includes('w')) {
                nW = startCropPos.width - dx;
                nL = startCropPos.left + dx;
            }
            if (currentHandle.includes('n')) {
                nH = startCropPos.height - dy;
                nT = startCropPos.top + dy;
            }

            setCropPosPx(nL, nT, nW, nH);
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging && !isResizing) return;
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];

        const dx = touch.clientX - startMousePos.x;
        const dy = touch.clientY - startMousePos.y;

        if (isDragging) {
            setCropPosPx(
                startCropPos.left + dx,
                startCropPos.top + dy,
                startCropPos.width,
                startCropPos.height
            );
        } else if (isResizing && currentHandle) {
            let nL = startCropPos.left;
            let nT = startCropPos.top;
            let nW = startCropPos.width;
            let nH = startCropPos.height;

            if (currentHandle.includes('e')) nW = startCropPos.width + dx;
            if (currentHandle.includes('s')) nH = startCropPos.height + dy;
            if (currentHandle.includes('w')) {
                nW = startCropPos.width - dx;
                nL = startCropPos.left + dx;
            }
            if (currentHandle.includes('n')) {
                nH = startCropPos.height - dy;
                nT = startCropPos.top + dy;
            }

            setCropPosPx(nL, nT, nW, nH);
        }
    });

    document.addEventListener('touchend', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
    });

    window.addEventListener('resize', () => {
        if (currentUploadedData && currentCropRect && cropStage) {
            stageRect = cropStage.getBoundingClientRect();
            const scaleX = stageRect.width / originalImgWidth;
            const scaleY = stageRect.height / originalImgHeight;
            setCropPosPx(
                currentCropRect.x * scaleX,
                currentCropRect.y * scaleY,
                currentCropRect.width * scaleX,
                currentCropRect.height * scaleY
            );
        }
    });

    function compressImageForUpload(file, maxDimension = 1600, quality = 0.85) {
        return new Promise((resolve) => {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                return resolve(file); // PDFs or other non-image files are passed directly
            }

            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                let w = img.width;
                let h = img.height;

                if (w <= maxDimension && h <= maxDimension && file.size < 800 * 1024) {
                    return resolve(file);
                }

                if (w > maxDimension || h > maxDimension) {
                    if (w > h) {
                        h = Math.round((h * maxDimension) / w);
                        w = maxDimension;
                    } else {
                        w = Math.round((w * maxDimension) / h);
                        h = maxDimension;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            const newName = (file.name || 'photo').replace(/\.[^/.]+$/, '') + '.jpg';
                            const compressed = new File([blob], newName, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(compressed);
                        } else {
                            resolve(file);
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };
            img.onerror = () => resolve(file);
            img.src = url;
        });
    }

    async function safeFetchJson(url, options = {}) {
        let res;
        try {
            res = await fetch(url, options);
        } catch (netErr) {
            throw new Error('Network request failed. If the Render instance is spinning up, please wait 5 seconds and retry.');
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const rawText = await res.text();
            if (res.status === 502 || res.status === 503 || res.status === 504) {
                throw new Error('Cloud server is waking up from idle. Please wait 5-10 seconds and try again.');
            }
            if (res.status === 413) {
                throw new Error('Uploaded file is too large. Please select a smaller photo or PDF.');
            }
            throw new Error(`Server returned HTTP ${res.status}: ${rawText.substring(0, 100)}`);
        }

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || `Request failed with status ${res.status}`);
        }
        return data;
    }

    async function uploadFile(file) {
        if (!file) return;

        showLoading('Uploading & Preparing File...', 'Optimizing document for instant extraction...');

        try {
            const optimizedFile = await compressImageForUpload(file);
            const formData = new FormData();
            formData.append('file', optimizedFile);

            const data = await safeFetchJson('/api/upload', {
                method: 'POST',
                body: formData
            });

            hideLoading();

            if (data.status === 'success') {
                currentUploadedData = data;
                originalImgWidth = data.width || 1200;
                originalImgHeight = data.height || 1600;

                // Update UI elements
                dropZone.style.display = 'none';
                filePreviewBar.style.display = 'flex';
                cropControlStrip.style.display = 'flex';
                if (pageCropPreviewCard) pageCropPreviewCard.style.display = 'block';

                lblFileName.innerText = data.filename;
                const fileExt = data.filename.split('.').pop().toUpperCase();
                lblFileMeta.innerText = `${fileExt} File • ${data.total_pages} Page(s) • (${originalImgWidth}×${originalImgHeight}px)`;

                const setupImageAndCrop = () => {
                    initCropOverlay();
                    if (cropStage) {
                        stageRect = cropStage.getBoundingClientRect();
                        setCropPosPx(0, 0, stageRect.width, stageRect.height);
                        if (cropBadge) cropBadge.innerText = `Full page: ${originalImgWidth} × ${originalImgHeight}`;
                        setActiveCropButton(btnClearCrop);
                    }
                };

                if (previewImage) {
                    previewImage.onload = () => {
                        setTimeout(setupImageAndCrop, 100);
                    };
                    previewImage.src = data.image_b64;

                    if (previewImage.complete && previewImage.naturalWidth > 0) {
                        setTimeout(setupImageAndCrop, 100);
                    }
                }

                btnConvert.disabled = false;
            } else {
                alert(`Upload Error: ${data.detail || 'Could not process file'}`);
            }
        } catch (err) {
            hideLoading();
            alert(`Failed to upload file: ${err.message}`);
        }
    }

    if (btnSnapCamera && cameraInput) {
        btnSnapCamera.addEventListener('click', () => cameraInput.click());
    }

    if (btnChooseFile && fileInput) {
        btnChooseFile.addEventListener('click', () => fileInput.click());
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFile(e.target.files[0]);
        }
    });

    if (cameraInput) {
        cameraInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0]);
            }
        });
    }

    function resetStudentUploadState() {
        currentUploadedData = null;
        if (fileInput) fileInput.value = '';
        if (cameraInput) cameraInput.value = '';
        if (filePreviewBar) filePreviewBar.style.display = 'none';
        if (cropControlStrip) cropControlStrip.style.display = 'none';
        if (pageCropPreviewCard) pageCropPreviewCard.style.display = 'none';
        if (dropZone) dropZone.style.display = 'block';
        if (btnConvert) btnConvert.disabled = true;
        if (resultCard) resultCard.style.display = 'none';
        renderStudentMetadata(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (btnChangeFile) {
        btnChangeFile.addEventListener('click', resetStudentUploadState);
    }

    ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files.length > 0) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });

    // ------------------------------------------------------------------
    // 4. Extraction & AI Recognition Action
    // ------------------------------------------------------------------
    let lastExtractedMetadata = null;

    btnConvert.addEventListener('click', async () => {
        if (!currentUploadedData) {
            alert('Please select a file first.');
            return;
        }

        showLoading(
            'Extracting Marksheet Data',
            'Processing marksheet table and student details...'
        );

        const payload = {
            file_b64_list: currentUploadedData.pages_b64 || [currentUploadedData.image_b64],
            engine: 'hybrid'
        };

        try {
            const data = await safeFetchJson('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            hideLoading();

            if (data.status === 'success') {
                const sections = data.sections || [];
                spreadsheetEditor.setSections(sections);

                // Update Student & Document Metadata Banner dynamically (editable inputs)
                lastExtractedMetadata = data.metadata || (sections.length > 0 ? sections[0].metadata : null);
                renderStudentMetadata(lastExtractedMetadata);

                const benchmarkCard = document.getElementById('benchmarkCard');
                if (data.comparative_benchmark && benchmarkCard) {
                    benchmarkCard.style.display = 'block';
                } else if (benchmarkCard) {
                    benchmarkCard.style.display = 'none';
                }

                // Unhide Results Card and scroll to view
                resultCard.style.display = 'block';
                resultCard.scrollIntoView({ behavior: 'smooth' });
            } else {
                alert(`Extraction error: ${data.detail || 'Failed to extract'}`);
            }
        } catch (err) {
            hideLoading();
            alert(`Extraction error: ${err.message}`);
        }
    });

    function cleanNumericRollNo(val) {
        if (!val) return '';
        const s = String(val).trim();
        // E.g. "44 / SE", "44/SE", "44-SE" -> "44"
        const m1 = s.match(/^\s*(\d+)\s*[/_-]/);
        if (m1) return m1[1];
        // E.g. "SE-46", "SE/46", "B-63" -> "46", "63"
        const m2 = s.match(/^[A-Za-z\s/_-]+(\d+)\s*$/);
        if (m2) return m2[1];
        // Standalone number
        const m3 = s.match(/\b\d+\b/);
        if (m3) return m3[0];
        return s;
    }

    function renderStudentMetadata(meta) {
        const metaStudentName = document.getElementById('metaStudentName');
        const metaPRN = document.getElementById('metaPRN');
        const metaRollNo = document.getElementById('metaRollNo');
        const metaBranch = document.getElementById('metaBranch');
        const metaDivision = document.getElementById('metaDivision');
        const metaSemester = document.getElementById('metaSemester');
        const metaSubject = document.getElementById('metaSubject');

        if (!meta) {
            if (metaStudentName) metaStudentName.value = '';
            if (metaPRN) metaPRN.value = '';
            if (metaRollNo) metaRollNo.value = '';
            if (metaBranch) metaBranch.value = '';
            if (metaDivision) metaDivision.value = '';
            if (metaSemester) metaSemester.value = '';
            if (metaSubject) metaSubject.value = '';
            return;
        }

        const name = meta.student_name || meta.name || '';
        const prn = meta.prn || '';
        const rawRoll = meta.roll_no || meta.roll_number || meta.rollno || '';
        const rollNo = cleanNumericRollNo(rawRoll) || rawRoll;
        const branch = meta.branch || '';
        const div = meta.division || '';
        const sem = meta.semester || '';
        const subj = meta.subject || '';

        if (metaStudentName) metaStudentName.value = name ? name.toUpperCase() : '';
        if (metaPRN) metaPRN.value = prn ? prn : '';
        if (metaRollNo) metaRollNo.value = rollNo ? rollNo.toUpperCase() : '';
        if (metaBranch) metaBranch.value = branch ? branch : '';
        if (metaDivision) metaDivision.value = div ? div : '';
        if (metaSemester) metaSemester.value = sem ? sem : '';
        if (metaSubject) metaSubject.value = subj ? subj : '';
    }

    function getEditedMetadata() {
        const metaStudentName = document.getElementById('metaStudentName');
        const metaPRN = document.getElementById('metaPRN');
        const metaRollNo = document.getElementById('metaRollNo');
        const metaBranch = document.getElementById('metaBranch');
        const metaDivision = document.getElementById('metaDivision');
        const metaSemester = document.getElementById('metaSemester');
        const metaSubject = document.getElementById('metaSubject');

        const rawRoll = metaRollNo ? metaRollNo.value.trim() : '';
        const cleanRoll = cleanNumericRollNo(rawRoll) || rawRoll;

        return {
            student_name: metaStudentName ? metaStudentName.value.trim() : '',
            prn: metaPRN ? metaPRN.value.trim() : '',
            roll_no: cleanRoll,
            branch: metaBranch ? metaBranch.value.trim() : '',
            division: metaDivision ? metaDivision.value.trim() : '',
            semester: metaSemester ? metaSemester.value.trim() : '',
            subject: metaSubject ? metaSubject.value.trim() : ''
        };
    }

    function extractQuestionMarksFromGrid(customEditor = spreadsheetEditor) {
        const sections = customEditor.getSections();
        if (!sections || sections.length === 0) return {};

        const sec = sections[0];
        const headers = sec.headers || [];
        const rows = sec.rows || [];

        const marksMap = {};
        if (rows.length >= 2) {
            // Row 1 is Mark Awarded row
            const awardRow = rows[1];
            headers.forEach((h, idx) => {
                const normH = String(h).trim().toLowerCase();
                if (normH.startsWith('1') || normH.startsWith('2') || normH.startsWith('3') || normH === 'total') {
                    const cellVal = idx < awardRow.length ? (awardRow[idx].value || awardRow[idx].text || '') : '';
                    marksMap[normH] = String(cellVal).trim();
                }
            });
        }
        return marksMap;
    }

    // ------------------------------------------------------------------
    // 5. Student Submit to MongoDB Database
    // ------------------------------------------------------------------
    btnSubmitToDb.addEventListener('click', async () => {
        const classroomId = studentClassroomSelect ? studentClassroomSelect.value : '';
        
        if (!classroomId) {
            alert('No active classroom session selected. Please select a classroom created by your faculty before submitting.');
            return;
        }

        const currentMeta = getEditedMetadata();
        const questionMarks = extractQuestionMarksFromGrid();

        if (!currentMeta.student_name && !currentMeta.prn && !currentMeta.roll_no) {
            alert('Please verify student metadata (Name / Roll No / PRN) before submitting.');
            return;
        }

        showLoading('Submitting Marksheet', 'Saving student marksheet to classroom database...');

        try {
            const data = await safeFetchJson('/api/submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    classroom_id: classroomId,
                    student_metadata: currentMeta,
                    marks_data: questionMarks,
                    raw_image_b64: currentUploadedData ? currentUploadedData.image_b64 : null
                })
            });

            hideLoading();

            if (data.status === 'success') {
                showToast(
                    'Submitted Successfully! 🎉',
                    `${currentMeta.student_name} (Roll: ${currentMeta.roll_no}) was stored in MongoDB Atlas.`
                );
                // Return student view back to initial clean state
                setTimeout(() => {
                    resetStudentUploadState();
                }, 1500);
            } else {
                alert(`Submission error: ${data.detail || 'Could not save marksheet'}`);
            }
        } catch (err) {
            hideLoading();
            alert(`Failed to submit to database: ${err.message}`);
        }
    });

    // ------------------------------------------------------------------
    // 6. Individual Student Excel / CSV Exports
    // ------------------------------------------------------------------
    btnExportExcel.addEventListener('click', async () => {
        const sections = spreadsheetEditor.getSections();
        if (!sections || sections.length === 0) return;

        showLoading('Generating Excel File', 'Formatting worksheets & auto-fitting columns...');
        const currentMeta = getEditedMetadata();

        try {
            const res = await fetch('/api/export/excel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sections: sections, metadata: currentMeta })
            });

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `marksheet_${currentMeta.roll_no || 'student'}.xlsx`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                alert('Failed to download Excel file.');
            }
        } catch (err) {
            alert(`Export error: ${err.message}`);
        } finally {
            hideLoading();
        }
    });

    btnExportCsv.addEventListener('click', async () => {
        const sections = spreadsheetEditor.getSections();
        if (!sections || sections.length === 0) return;

        showLoading('Generating CSV File', 'Creating clean CSV...');
        const currentMeta = getEditedMetadata();

        try {
            const res = await fetch('/api/export/csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sections: sections, metadata: currentMeta })
            });

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `marksheet_${currentMeta.roll_no || 'student'}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                alert('Failed to download CSV file.');
            }
        } catch (err) {
            alert(`Export error: ${err.message}`);
        } finally {
            hideLoading();
        }
    });

    // ------------------------------------------------------------------
    // 7. Faculty Dashboard & Live Class Roster
    // ------------------------------------------------------------------
    async function loadFacultyRoster() {
        const classroomId = facultyClassroomSelect ? facultyClassroomSelect.value : (activeClassroomsList[0]?.classroom_id || 'SE_IT_B_IV_CNND_IA1');
        if (!classroomId) return;

        try {
            const res = await fetch(`/api/submissions/${classroomId}`);
            const data = await res.json();

            if (data.status === 'success') {
                currentRosterData = data.submissions || [];
                renderFacultyMetrics(currentRosterData);
                renderFacultyRosterTable(currentRosterData);
            }
        } catch (err) {
            console.error('Failed to fetch faculty roster from MongoDB:', err);
        }
    }

    function parseScoreValue(scoreStr, marksMap) {
        const s = String(scoreStr || '').trim();
        if (s) {
            if (s.includes('1/2')) {
                const base = s.replace('1/2', '').trim();
                const baseNum = parseFloat(base) || 0;
                return baseNum + 0.5;
            }
            if (s.includes('/')) {
                const parts = s.split('/');
                const num = parseFloat(parts[0].trim().replace(/[^0-9.]/g, ''));
                if (!isNaN(num)) return num;
            }
            const cleaned = s.replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            if (!isNaN(num)) return num;
        }

        // Fallback: calculate sum from individual awarded question marks
        if (marksMap) {
            let calcSum = 0;
            let hasAny = false;
            Object.values(marksMap).forEach(v => {
                const sv = String(v || '').trim();
                if (sv) {
                    if (sv.includes('1/2')) {
                        const base = sv.replace('1/2', '').trim();
                        const bNum = parseFloat(base) || 0;
                        calcSum += (bNum + 0.5);
                        hasAny = true;
                    } else {
                        const cn = parseFloat(sv.replace(/[^0-9.]/g, ''));
                        if (!isNaN(cn)) {
                            calcSum += cn;
                            hasAny = true;
                        }
                    }
                }
            });
            if (hasAny) return calcSum;
        }

        return NaN;
    }

    function renderFacultyMetrics(submissions) {
        if (!submissions || submissions.length === 0) {
            if (statTotalSubmissions) statTotalSubmissions.innerText = '0';
            if (statClassAverage) statClassAverage.innerText = '0.0 / 20';
            if (statHighestScore) statHighestScore.innerText = '0 / 20';
            if (statTopStudent) statTopStudent.innerText = 'No submissions';
            if (statLatestTime) statLatestTime.innerText = '-';
            if (statLatestStudent) statLatestStudent.innerText = 'No submissions';
            return;
        }

        const count = submissions.length;
        if (statTotalSubmissions) statTotalSubmissions.innerText = String(count);

        let totalSum = 0;
        let validScoresCount = 0;
        let highest = -1;
        let topStudentName = '';

        submissions.forEach(s => {
            const totNum = parseScoreValue(s.total_marks, s.marks_awarded);
            if (!isNaN(totNum) && totNum >= 0) {
                totalSum += totNum;
                validScoresCount++;
                if (totNum > highest) {
                    highest = totNum;
                    topStudentName = s.student_name || s.roll_no;
                }
            }
        });

        const avg = validScoresCount > 0 ? (totalSum / validScoresCount).toFixed(1) : '0.0';
        if (statClassAverage) statClassAverage.innerText = `${avg} / 20`;
        if (statHighestScore) statHighestScore.innerText = highest >= 0 ? `${highest} / 20` : '0 / 20';
        if (statTopStudent) statTopStudent.innerText = topStudentName || 'N/A';

        // Latest submission info
        const latest = submissions[submissions.length - 1];
        if (statLatestTime) statLatestTime.innerText = 'Just now (Synced)';
        if (statLatestStudent) statLatestStudent.innerText = latest ? `${latest.student_name} (${latest.roll_no})` : '-';
    }

    function renderFacultyRosterTable(submissions) {
        if (!facultyRosterTableBody) return;

        if (!submissions || submissions.length === 0) {
            facultyRosterTableBody.innerHTML = '';
            if (rosterEmptyState) rosterEmptyState.style.display = 'block';
            return;
        }

        if (rosterEmptyState) rosterEmptyState.style.display = 'none';

        const rowsHtml = submissions.map((s, idx) => {
            const marks = s.marks_awarded || {};
            const cleanTot = parseScoreValue(s.total_marks, marks);
            const displayTotal = !isNaN(cleanTot) ? cleanTot : (s.total_marks || '-');

            return `
                <tr>
                    <td><strong>${idx + 1}</strong></td>
                    <td><span style="font-weight:700; color:#1E40AF;">${cleanNumericRollNo(s.roll_no) || s.roll_no || '-'}</span></td>
                    <td><span style="font-family:var(--font-code); font-size:0.82rem;">${s.prn || '-'}</span></td>
                    <td><strong>${s.student_name || '-'}</strong></td>
                    <td>${marks['1a'] || ''}</td>
                    <td>${marks['1b'] || ''}</td>
                    <td>${marks['1c'] || ''}</td>
                    <td>${marks['1d'] || ''}</td>
                    <td>${marks['1e'] || ''}</td>
                    <td>${marks['1f'] || ''}</td>
                    <td>${marks['2a'] || ''}</td>
                    <td>${marks['2b'] || ''}</td>
                    <td>${marks['3a'] || ''}</td>
                    <td>${marks['3b'] || ''}</td>
                    <td class="total-col" style="font-weight:700; color:#15803D;">${displayTotal}</td>
                    <td><span class="roster-badge-status"><i class="fa-solid fa-check"></i> ${s.status || 'Verified'}</span></td>
                </tr>
            `;
        }).join('');

        facultyRosterTableBody.innerHTML = rowsHtml;
    }

    // Live search filter in faculty roster
    if (facultyRosterSearch) {
        facultyRosterSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderFacultyRosterTable(currentRosterData);
                return;
            }

            const filtered = currentRosterData.filter(s => {
                const name = (s.student_name || '').toLowerCase();
                const roll = (s.roll_no || '').toLowerCase();
                const prn = (s.prn || '').toLowerCase();
                return name.includes(query) || roll.includes(query) || prn.includes(query);
            });

            renderFacultyRosterTable(filtered);
        });
    }

    if (studentClassroomSelect) {
        studentClassroomSelect.addEventListener('change', () => {
            updateStudentLockState(studentClassroomSelect.value);
        });
    }

    if (facultyClassroomSelect) {
        facultyClassroomSelect.addEventListener('change', () => {
            updateFacultyToggleState(facultyClassroomSelect.value);
            loadFacultyRoster();
        });
    }

    if (facultySubmissionToggle) {
        facultySubmissionToggle.addEventListener('change', async (e) => {
            const classroomId = facultyClassroomSelect ? facultyClassroomSelect.value : null;
            if (!classroomId) return;
            const newStatus = e.target.checked;

            try {
                const res = await fetch('/api/classrooms/toggle-submission', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        classroom_id: classroomId,
                        is_submission_open: newStatus
                    })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    const cls = activeClassroomsList.find(c => c.classroom_id === classroomId);
                    if (cls) cls.is_submission_open = newStatus;

                    updateFacultyToggleState(classroomId);
                    updateStudentLockState(studentClassroomSelect ? studentClassroomSelect.value : null);

                    const toastTitle = newStatus ? 'Submissions Opened' : 'Submissions Locked';
                    const toastMsg = newStatus ? 'Students can now upload answer sheets to this batch.' : 'Student uploads locked for this batch.';
                    showToast(toastTitle, toastMsg);
                } else {
                    e.target.checked = !newStatus;
                    alert(`Failed to change status: ${data.detail}`);
                }
            } catch (err) {
                e.target.checked = !newStatus;
                alert(`Error toggling status: ${err.message}`);
            }
        });
    }

    if (btnRefreshFacultyRoster) {
        btnRefreshFacultyRoster.addEventListener('click', async () => {
            showToast('Refreshing Roster...', 'Fetching latest submissions from MongoDB Atlas.');
            await loadFacultyRoster();
        });
    }

    // Master Class Excel Export
    if (btnFacultyExportExcel) {
        btnFacultyExportExcel.addEventListener('click', async () => {
            const classroomId = facultyClassroomSelect ? facultyClassroomSelect.value : 'SE_IT_B_IV_CNND_IA1';
            showLoading('Exporting Master Class Excel', 'Compiling all student grades into one Excel workbook...');

            try {
                const res = await fetch(`/api/export/master-excel/${classroomId}`);
                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `master_grade_sheet_${classroomId}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } else {
                    alert('Failed to export Master Excel sheet.');
                }
            } catch (err) {
                alert(`Export error: ${err.message}`);
            } finally {
                hideLoading();
            }
        });
    }

    // Master Class CSV Export
    if (btnFacultyExportCsv) {
        btnFacultyExportCsv.addEventListener('click', async () => {
            const classroomId = facultyClassroomSelect ? facultyClassroomSelect.value : 'SE_IT_B_IV_CNND_IA1';
            showLoading('Exporting Master CSV', 'Generating clean CSV for all students...');

            try {
                const res = await fetch(`/api/export/master-csv/${classroomId}`);
                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `master_grade_sheet_${classroomId}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } else {
                    alert('Failed to export Master CSV file.');
                }
            } catch (err) {
                alert(`Export error: ${err.message}`);
            } finally {
                hideLoading();
            }
        });
    }

    // ------------------------------------------------------------------
    // 8. Grid Tools & Utilities
    // ------------------------------------------------------------------
    if (btnAddRow) btnAddRow.addEventListener('click', () => spreadsheetEditor.addRow());
    if (btnAddCol) btnAddCol.addEventListener('click', () => spreadsheetEditor.addColumn());
    if (btnClearGrid) {
        btnClearGrid.addEventListener('click', () => {
            if (confirm('Clear current spreadsheet grid?')) {
                spreadsheetEditor.clearGrid();
            }
        });
    }

    function showToast(title, msg) {
        if (!toastNotification) return;
        toastTitle.innerText = title;
        toastMessage.innerText = msg;
        toastNotification.style.display = 'flex';
        setTimeout(() => {
            toastNotification.style.display = 'none';
        }, 4000);
    }

    function showLoading(title, msg) {
        loadingTitle.innerText = title;
        loadingMessage.innerText = msg;
        loadingOverlay.style.display = 'flex';
    }

    function hideLoading() {
        loadingOverlay.style.display = 'none';
    }

    // ------------------------------------------------------------------
    // 9. Faculty Marksheet Upload & AI Data Extraction
    // ------------------------------------------------------------------
    const facultySpreadsheetEditor = new SpreadsheetEditorController(
        'facultySectionTabsBar',
        'facultyTableHead',
        'facultyTableBody'
    );

    // Faculty Upload State
    let currentFacultyUploadedData = null;
    let originalFacultyImgWidth = 1204;
    let originalFacultyImgHeight = 1600;
    let currentFacultyCropRect = null;
    let isFacultyAutoCropped = false;
    let lastFacultyExtractedMetadata = null;

    // Faculty Navigation & Containers
    const tabFacultyRosterView = document.getElementById('tabFacultyRosterView');
    const tabFacultyUploadView = document.getElementById('tabFacultyUploadView');
    const facultyRosterContainer = document.getElementById('facultyRosterContainer');
    const facultyUploadContainer = document.getElementById('facultyUploadContainer');
    const btnHeaderFacultyUpload = document.getElementById('btnHeaderFacultyUpload');
    const btnBackToFacultyRoster = document.getElementById('btnBackToFacultyRoster');
    const facultyUploadClassroomSelect = document.getElementById('facultyUploadClassroomSelect');

    // Faculty Upload Controls
    const facultyDropZone = document.getElementById('facultyDropZone');
    const facultyFileInput = document.getElementById('facultyFileInput');
    const facultyCameraInput = document.getElementById('facultyCameraInput');
    const btnFacultySnapCamera = document.getElementById('btnFacultySnapCamera');
    const btnFacultyChooseFile = document.getElementById('btnFacultyChooseFile');
    const facultyFilePreviewBar = document.getElementById('facultyFilePreviewBar');
    const lblFacultyFileName = document.getElementById('lblFacultyFileName');
    const lblFacultyFileMeta = document.getElementById('lblFacultyFileMeta');
    const btnFacultyChangeFile = document.getElementById('btnFacultyChangeFile');

    // Faculty Crop Controls
    const facultyCropControlStrip = document.getElementById('facultyCropControlStrip');
    const btnFacultyAutoCrop = document.getElementById('btnFacultyAutoCrop');
    const btnFacultyManualCrop = document.getElementById('btnFacultyManualCrop');
    const btnFacultyClearCrop = document.getElementById('btnFacultyClearCrop');

    const facultyPageCropPreviewCard = document.getElementById('facultyPageCropPreviewCard');
    const facultyCropBadge = document.getElementById('facultyCropBadge');
    const facultyCropStage = document.getElementById('facultyCropStage');
    const facultyPreviewImage = document.getElementById('facultyPreviewImage');
    const facultyCropBox = document.getElementById('facultyCropBox');

    // Faculty Action & Results
    const btnFacultyConvert = document.getElementById('btnFacultyConvert');
    const facultyResultCard = document.getElementById('facultyResultCard');
    const btnFacultySubmitToDb = document.getElementById('btnFacultySubmitToDb');
    const btnFacultySingleExportExcel = document.getElementById('btnFacultySingleExportExcel');
    const btnFacultySingleExportCsv = document.getElementById('btnFacultySingleExportCsv');

    const btnAddFacultyRow = document.getElementById('btnAddFacultyRow');
    const btnAddFacultyCol = document.getElementById('btnAddFacultyCol');
    const btnClearFacultyGrid = document.getElementById('btnClearFacultyGrid');

    // Faculty Sub-View Switcher
    function switchFacultySubView(view) {
        if (view === 'roster') {
            if (tabFacultyRosterView) tabFacultyRosterView.classList.add('active');
            if (tabFacultyUploadView) tabFacultyUploadView.classList.remove('active');
            if (facultyRosterContainer) facultyRosterContainer.style.display = 'block';
            if (facultyUploadContainer) facultyUploadContainer.style.display = 'none';
            loadFacultyRoster();
        } else {
            if (tabFacultyUploadView) tabFacultyUploadView.classList.add('active');
            if (tabFacultyRosterView) tabFacultyRosterView.classList.remove('active');
            if (facultyRosterContainer) facultyRosterContainer.style.display = 'none';
            if (facultyUploadContainer) facultyUploadContainer.style.display = 'block';

            if (facultyUploadClassroomSelect && facultyClassroomSelect) {
                facultyUploadClassroomSelect.value = facultyClassroomSelect.value;
            }
        }
    }

    if (tabFacultyRosterView) tabFacultyRosterView.addEventListener('click', () => switchFacultySubView('roster'));
    if (tabFacultyUploadView) tabFacultyUploadView.addEventListener('click', () => switchFacultySubView('upload'));
    if (btnHeaderFacultyUpload) btnHeaderFacultyUpload.addEventListener('click', () => switchFacultySubView('upload'));
    if (btnBackToFacultyRoster) btnBackToFacultyRoster.addEventListener('click', () => switchFacultySubView('roster'));

    if (facultyUploadClassroomSelect) {
        facultyUploadClassroomSelect.addEventListener('change', () => {
            if (facultyClassroomSelect) {
                facultyClassroomSelect.value = facultyUploadClassroomSelect.value;
                updateFacultyToggleState(facultyUploadClassroomSelect.value);
            }
        });
    }

    // Faculty Crop Handlers
    let fStageRect = { width: 1, height: 1 };
    let fCropPos = { left: 0, top: 0, width: 0, height: 0 };
    let fIsDragging = false;
    let fIsResizing = false;
    let fCurrentHandle = null;
    let fStartMousePos = { x: 0, y: 0 };
    let fStartCropPos = { left: 0, top: 0, width: 0, height: 0 };

    function initFacultyCropOverlay() {
        if (!facultyCropStage) return;
        fStageRect = facultyCropStage.getBoundingClientRect();
        const defaultW = fStageRect.width * 0.85;
        const defaultH = fStageRect.height * 0.25;
        const defaultL = (fStageRect.width - defaultW) / 2;
        const defaultT = (fStageRect.height - defaultH) / 3;
        setFacultyCropPosPx(defaultL, defaultT, defaultW, defaultH);
    }

    function setFacultyCropPosPx(left, top, width, height) {
        if (!facultyCropStage || !facultyCropBox) return;
        fStageRect = facultyCropStage.getBoundingClientRect();
        if (fStageRect.width === 0 || fStageRect.height === 0) return;

        left = Math.max(0, Math.min(left, fStageRect.width - 20));
        top = Math.max(0, Math.min(top, fStageRect.height - 20));
        width = Math.max(20, Math.min(width, fStageRect.width - left));
        height = Math.max(20, Math.min(height, fStageRect.height - top));

        fCropPos = { left, top, width, height };

        facultyCropBox.style.left = `${left}px`;
        facultyCropBox.style.top = `${top}px`;
        facultyCropBox.style.width = `${width}px`;
        facultyCropBox.style.height = `${height}px`;

        const scaleX = originalFacultyImgWidth / fStageRect.width;
        const scaleY = originalFacultyImgHeight / fStageRect.height;

        const origX = Math.round(left * scaleX);
        const origY = Math.round(top * scaleY);
        const origW = Math.round(width * scaleX);
        const origH = Math.round(height * scaleY);

        currentFacultyCropRect = { x: origX, y: origY, width: origW, height: origH };

        if (facultyCropBadge) {
            const modePrefix = isFacultyAutoCropped ? 'Auto crop:' : 'Manual crop:';
            facultyCropBadge.innerText = `${modePrefix} ${origW} × ${origH}`;
        }
    }

    function setFacultyActiveCropButton(activeBtn) {
        [btnFacultyAutoCrop, btnFacultyManualCrop, btnFacultyClearCrop].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });
        if (activeBtn) activeBtn.classList.add('active');
    }

    async function triggerFacultyAutoCrop() {
        if (!currentFacultyUploadedData || !currentFacultyUploadedData.image_b64) return;
        setFacultyActiveCropButton(btnFacultyAutoCrop);

        try {
            const res = await fetch('/api/autocrop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_b64: currentFacultyUploadedData.image_b64 })
            });

            const data = await res.json();
            if (data.status === 'success' && data.crop) {
                isFacultyAutoCropped = true;
                const crop = data.crop;
                fStageRect = facultyCropStage.getBoundingClientRect();
                const scaleX = fStageRect.width / originalFacultyImgWidth;
                const scaleY = fStageRect.height / originalFacultyImgHeight;

                setFacultyCropPosPx(
                    crop.x * scaleX,
                    crop.y * scaleY,
                    crop.width * scaleX,
                    crop.height * scaleY
                );
            }
        } catch (err) {
            console.warn("Faculty auto crop request failed, using manual crop box.", err);
        }
    }

    if (btnFacultyAutoCrop) {
        btnFacultyAutoCrop.addEventListener('click', () => triggerFacultyAutoCrop());
    }

    if (btnFacultyManualCrop) {
        btnFacultyManualCrop.addEventListener('click', () => {
            isFacultyAutoCropped = false;
            setFacultyActiveCropButton(btnFacultyManualCrop);
            if (currentFacultyCropRect && facultyCropBadge) {
                facultyCropBadge.innerText = `Manual crop: ${currentFacultyCropRect.width} × ${currentFacultyCropRect.height}`;
            }
        });
    }

    if (btnFacultyClearCrop) {
        btnFacultyClearCrop.addEventListener('click', () => {
            isFacultyAutoCropped = false;
            setFacultyActiveCropButton(btnFacultyClearCrop);
            if (facultyCropStage) {
                fStageRect = facultyCropStage.getBoundingClientRect();
                setFacultyCropPosPx(0, 0, fStageRect.width, fStageRect.height);
                if (facultyCropBadge) facultyCropBadge.innerText = `Full page: ${originalFacultyImgWidth} × ${originalFacultyImgHeight}`;
            }
        });
    }

    // Faculty Crop Box Listeners
    if (facultyCropBox) {
        facultyCropBox.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('crop-handle')) {
                fIsResizing = true;
                fCurrentHandle = e.target.getAttribute('data-handle');
            } else {
                fIsDragging = true;
            }

            isFacultyAutoCropped = false;
            setFacultyActiveCropButton(btnFacultyManualCrop);

            fStartMousePos = { x: e.clientX, y: e.clientY };
            fStartCropPos = { ...fCropPos };
            e.stopPropagation();
            e.preventDefault();
        });

        facultyCropBox.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            if (e.target.classList.contains('crop-handle')) {
                fIsResizing = true;
                fCurrentHandle = e.target.getAttribute('data-handle');
            } else {
                fIsDragging = true;
            }

            isFacultyAutoCropped = false;
            setFacultyActiveCropButton(btnFacultyManualCrop);

            fStartMousePos = { x: touch.clientX, y: touch.clientY };
            fStartCropPos = { ...fCropPos };
            e.stopPropagation();
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!fIsDragging && !fIsResizing) return;

        const dx = e.clientX - fStartMousePos.x;
        const dy = e.clientY - fStartMousePos.y;

        if (fIsDragging) {
            setFacultyCropPosPx(
                fStartCropPos.left + dx,
                fStartCropPos.top + dy,
                fStartCropPos.width,
                fStartCropPos.height
            );
        } else if (fIsResizing && fCurrentHandle) {
            let nL = fStartCropPos.left;
            let nT = fStartCropPos.top;
            let nW = fStartCropPos.width;
            let nH = fStartCropPos.height;

            if (fCurrentHandle.includes('e')) nW = fStartCropPos.width + dx;
            if (fCurrentHandle.includes('s')) nH = fStartCropPos.height + dy;
            if (fCurrentHandle.includes('w')) {
                nW = fStartCropPos.width - dx;
                nL = fStartCropPos.left + dx;
            }
            if (fCurrentHandle.includes('n')) {
                nH = fStartCropPos.height - dy;
                nT = fStartCropPos.top + dy;
            }

            setFacultyCropPosPx(nL, nT, nW, nH);
        }
    });

    document.addEventListener('mouseup', () => {
        fIsDragging = false;
        fIsResizing = false;
        fCurrentHandle = null;
    });

    document.addEventListener('touchmove', (e) => {
        if (!fIsDragging && !fIsResizing) return;
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];

        const dx = touch.clientX - fStartMousePos.x;
        const dy = touch.clientY - fStartMousePos.y;

        if (fIsDragging) {
            setFacultyCropPosPx(
                fStartCropPos.left + dx,
                fStartCropPos.top + dy,
                fStartCropPos.width,
                fStartCropPos.height
            );
        } else if (fIsResizing && fCurrentHandle) {
            let nL = fStartCropPos.left;
            let nT = fStartCropPos.top;
            let nW = fStartCropPos.width;
            let nH = fStartCropPos.height;

            if (fCurrentHandle.includes('e')) nW = fStartCropPos.width + dx;
            if (fCurrentHandle.includes('s')) nH = fStartCropPos.height + dy;
            if (fCurrentHandle.includes('w')) {
                nW = fStartCropPos.width - dx;
                nL = fStartCropPos.left + dx;
            }
            if (fCurrentHandle.includes('n')) {
                nH = fStartCropPos.height - dy;
                nT = fStartCropPos.top + dy;
            }

            setFacultyCropPosPx(nL, nT, nW, nH);
        }
    });

    document.addEventListener('touchend', () => {
        fIsDragging = false;
        fIsResizing = false;
        fCurrentHandle = null;
    });

    window.addEventListener('resize', () => {
        if (currentFacultyUploadedData && currentFacultyCropRect && facultyCropStage) {
            fStageRect = facultyCropStage.getBoundingClientRect();
            const scaleX = fStageRect.width / originalFacultyImgWidth;
            const scaleY = fStageRect.height / originalFacultyImgHeight;
            setFacultyCropPosPx(
                currentFacultyCropRect.x * scaleX,
                currentFacultyCropRect.y * scaleY,
                currentFacultyCropRect.width * scaleX,
                currentFacultyCropRect.height * scaleY
            );
        }
    });

    // ------------------------------------------------------------------
    // Batch Upload & Verification Carousel State
    // ------------------------------------------------------------------
    let facultySelectedFiles = []; // Array of File objects (up to 10)
    let facultyBatchResults = [];  // Array of extracted marksheet objects
    let currentBatchIndex = 0;     // Currently viewed student index

    // Batch UI Elements
    const facultyBatchQueueContainer = document.getElementById('facultyBatchQueueContainer');
    const lblBatchQueueCount = document.getElementById('lblBatchQueueCount');
    const facultyBatchChipsContainer = document.getElementById('facultyBatchChipsContainer');
    const btnFacultyAddMoreFiles = document.getElementById('btnFacultyAddMoreFiles');
    const btnFacultyClearBatch = document.getElementById('btnFacultyClearBatch');

    const batchVerificationToolbar = document.getElementById('batchVerificationToolbar');
    const btnBatchPrevStudent = document.getElementById('btnBatchPrevStudent');
    const btnBatchNextStudent = document.getElementById('btnBatchNextStudent');
    const batchCurrentIndexLabel = document.getElementById('batchCurrentIndexLabel');
    const batchTotalCountLabel = document.getElementById('batchTotalCountLabel');
    const batchCurrentStudentName = document.getElementById('batchCurrentStudentName');
    const batchCurrentStudentRoll = document.getElementById('batchCurrentStudentRoll');
    const batchVerifyBadge = document.getElementById('batchVerifyBadge');
    const btnBatchVerifyAndNext = document.getElementById('btnBatchVerifyAndNext');
    const batchStepperContainer = document.getElementById('batchStepperContainer');
    const btnFacultySubmitAllToDb = document.getElementById('btnFacultySubmitAllToDb');
    const lblBatchUploadAllCount = document.getElementById('lblBatchUploadAllCount');

    const batchImagePreviewCard = document.getElementById('batchImagePreviewCard');
    const btnToggleBatchScanPreview = document.getElementById('btnToggleBatchScanPreview');
    const batchImagePreviewBody = document.getElementById('batchImagePreviewBody');
    const batchScanImg = document.getElementById('batchScanImg');
    const iconToggleScan = document.getElementById('iconToggleScan');

    // ------------------------------------------------------------------
    // Batch File Selection & Queue Management (Up to 10 Marksheets)
    // ------------------------------------------------------------------
    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function renderFacultyBatchQueue() {
        if (!facultyBatchQueueContainer || !facultyBatchChipsContainer) return;

        if (facultySelectedFiles.length === 0) {
            facultyBatchQueueContainer.style.display = 'none';
            if (facultyDropZone) facultyDropZone.style.display = 'block';
            if (btnFacultyConvert) {
                btnFacultyConvert.disabled = true;
                btnFacultyConvert.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Convert & Extract Numbers';
            }
            return;
        }

        facultyBatchQueueContainer.style.display = 'block';
        if (facultyDropZone) facultyDropZone.style.display = 'none';

        if (lblBatchQueueCount) {
            lblBatchQueueCount.innerText = `${facultySelectedFiles.length} / 10 Marksheets Selected`;
        }

        // Render file chips
        facultyBatchChipsContainer.innerHTML = '';
        facultySelectedFiles.forEach((file, idx) => {
            const chip = document.createElement('div');
            chip.className = 'batch-file-chip';

            const isPdf = file.name.toLowerCase().endsWith('.pdf');
            const iconClass = isPdf ? 'fa-solid fa-file-pdf' : 'fa-solid fa-file-image';

            chip.innerHTML = `
                <div class="batch-file-chip-info">
                    <div class="batch-file-chip-icon">
                        <i class="${iconClass}"></i>
                    </div>
                    <div>
                        <strong class="batch-file-chip-name" title="${file.name}">#${idx + 1}: ${file.name}</strong>
                        <span class="batch-file-chip-size">${formatFileSize(file.size)}</span>
                    </div>
                </div>
                <button type="button" class="batch-file-chip-remove" title="Remove this marksheet" data-idx="${idx}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;

            const removeBtn = chip.querySelector('.batch-file-chip-remove');
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    facultySelectedFiles.splice(idx, 1);
                    renderFacultyBatchQueue();
                });
            }

            facultyBatchChipsContainer.appendChild(chip);
        });

        if (btnFacultyConvert) {
            btnFacultyConvert.disabled = false;
            if (facultySelectedFiles.length === 1) {
                btnFacultyConvert.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Convert & Extract Marksheet';
            } else {
                btnFacultyConvert.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Convert & Extract All (${facultySelectedFiles.length} Marksheets)`;
            }
        }
    }

    function addFilesToBatch(newFiles) {
        if (!newFiles || newFiles.length === 0) return;
        const filesArr = Array.from(newFiles);

        const currentTotal = facultySelectedFiles.length;
        const allowedSlots = 10 - currentTotal;

        if (allowedSlots <= 0) {
            showToast('Batch Limit Reached', 'You can upload a maximum of 10 marksheets at once.');
            return;
        }

        if (filesArr.length > allowedSlots) {
            showToast('Batch Limit: 10 Files', `Only the first ${allowedSlots} marksheet(s) were added to stay within the 10-sheet limit.`);
            facultySelectedFiles = facultySelectedFiles.concat(filesArr.slice(0, allowedSlots));
        } else {
            facultySelectedFiles = facultySelectedFiles.concat(filesArr);
        }

        renderFacultyBatchQueue();
    }

    if (btnFacultySnapCamera && facultyCameraInput) {
        btnFacultySnapCamera.addEventListener('click', () => facultyCameraInput.click());
    }

    if (btnFacultyChooseFile && facultyFileInput) {
        btnFacultyChooseFile.addEventListener('click', () => facultyFileInput.click());
    }

    if (btnFacultyAddMoreFiles && facultyFileInput) {
        btnFacultyAddMoreFiles.addEventListener('click', () => facultyFileInput.click());
    }

    if (btnFacultyClearBatch) {
        btnFacultyClearBatch.addEventListener('click', () => {
            facultySelectedFiles = [];
            if (facultyFileInput) facultyFileInput.value = '';
            if (facultyCameraInput) facultyCameraInput.value = '';
            renderFacultyBatchQueue();
        });
    }

    if (facultyFileInput) {
        facultyFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                addFilesToBatch(e.target.files);
                facultyFileInput.value = '';
            }
        });
    }

    if (facultyCameraInput) {
        facultyCameraInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                addFilesToBatch(e.target.files);
                facultyCameraInput.value = '';
            }
        });
    }

    if (facultyDropZone) {
        ['dragenter', 'dragover'].forEach(name => {
            facultyDropZone.addEventListener(name, (e) => {
                e.preventDefault();
                facultyDropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(name => {
            facultyDropZone.addEventListener(name, (e) => {
                e.preventDefault();
                facultyDropZone.classList.remove('drag-over');
            });
        });

        facultyDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            facultyDropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                addFilesToBatch(e.dataTransfer.files);
            }
        });
    }

    // Toggle Scan Image Preview visibility
    if (btnToggleBatchScanPreview && batchImagePreviewBody) {
        btnToggleBatchScanPreview.addEventListener('click', () => {
            const isHidden = batchImagePreviewBody.style.display === 'none';
            batchImagePreviewBody.style.display = isHidden ? 'block' : 'none';
            if (iconToggleScan) {
                iconToggleScan.className = isHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
            }
        });
    }

    // Faculty Metadata Helpers
    function renderFacultyStudentMetadata(meta) {
        const metaStudentName = document.getElementById('facultyMetaStudentName');
        const metaPRN = document.getElementById('facultyMetaPRN');
        const metaRollNo = document.getElementById('facultyMetaRollNo');
        const metaBranch = document.getElementById('facultyMetaBranch');
        const metaDivision = document.getElementById('facultyMetaDivision');
        const metaSemester = document.getElementById('facultyMetaSemester');
        const metaSubject = document.getElementById('facultyMetaSubject');

        if (!meta) {
            if (metaStudentName) metaStudentName.value = '';
            if (metaPRN) metaPRN.value = '';
            if (metaRollNo) metaRollNo.value = '';
            if (metaBranch) metaBranch.value = '';
            if (metaDivision) metaDivision.value = '';
            if (metaSemester) metaSemester.value = '';
            if (metaSubject) metaSubject.value = '';
            return;
        }

        const name = meta.student_name || meta.name || '';
        const prn = meta.prn || '';
        const rawRoll = meta.roll_no || meta.roll_number || meta.rollno || '';
        const rollNo = cleanNumericRollNo(rawRoll) || rawRoll;
        const branch = meta.branch || '';
        const div = meta.division || '';
        const sem = meta.semester || '';
        const subj = meta.subject || '';

        if (metaStudentName) metaStudentName.value = name ? name.toUpperCase() : '';
        if (metaPRN) metaPRN.value = prn ? prn : '';
        if (metaRollNo) metaRollNo.value = rollNo ? rollNo.toUpperCase() : '';
        if (metaBranch) metaBranch.value = branch ? branch : '';
        if (metaDivision) metaDivision.value = div ? div : '';
        if (metaSemester) metaSemester.value = sem ? sem : '';
        if (metaSubject) metaSubject.value = subj ? subj : '';
    }

    function getFacultyEditedMetadata() {
        const metaStudentName = document.getElementById('facultyMetaStudentName');
        const metaPRN = document.getElementById('facultyMetaPRN');
        const metaRollNo = document.getElementById('facultyMetaRollNo');
        const metaBranch = document.getElementById('facultyMetaBranch');
        const metaDivision = document.getElementById('facultyMetaDivision');
        const metaSemester = document.getElementById('facultyMetaSemester');
        const metaSubject = document.getElementById('facultyMetaSubject');

        const rawRoll = metaRollNo ? metaRollNo.value.trim() : '';
        const cleanRoll = cleanNumericRollNo(rawRoll) || rawRoll;

        return {
            student_name: metaStudentName ? metaStudentName.value.trim() : '',
            prn: metaPRN ? metaPRN.value.trim() : '',
            roll_no: cleanRoll,
            branch: metaBranch ? metaBranch.value.trim() : '',
            division: metaDivision ? metaDivision.value.trim() : '',
            semester: metaSemester ? metaSemester.value.trim() : '',
            subject: metaSubject ? metaSubject.value.trim() : ''
        };
    }

    // ------------------------------------------------------------------
    // Batch Extraction (Processes All Selected Marksheets in Sequence)
    // ------------------------------------------------------------------
    if (btnFacultyConvert) {
        btnFacultyConvert.addEventListener('click', async () => {
            if (!facultySelectedFiles || facultySelectedFiles.length === 0) {
                alert('Please select at least one marksheet file.');
                return;
            }

            const total = facultySelectedFiles.length;
            facultyBatchResults = [];

            for (let i = 0; i < total; i++) {
                const file = facultySelectedFiles[i];
                showLoading(
                    `Extracting Marksheets (${i + 1} of ${total})`,
                    `Processing "${file.name}" with Hybrid AI Engine...`
                );

                try {
                    const optimizedFile = await compressImageForUpload(file);
                    const formData = new FormData();
                    formData.append('file', optimizedFile);

                    const uploadRes = await safeFetchJson('/api/upload', {
                        method: 'POST',
                        body: formData
                    });

                    if (uploadRes.status !== 'success') {
                        throw new Error(uploadRes.detail || `Upload failed for ${file.name}`);
                    }

                    const extractPayload = {
                        file_b64_list: uploadRes.pages_b64 || [uploadRes.image_b64],
                        engine: 'hybrid'
                    };

                    const extractRes = await safeFetchJson('/api/extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(extractPayload)
                    });

                    if (extractRes.status !== 'success') {
                        throw new Error(extractRes.detail || `Extraction failed for ${file.name}`);
                    }

                    const sections = extractRes.sections || [];
                    const rawMeta = extractRes.metadata || (sections.length > 0 ? sections[0].metadata : null);

                    const metaObj = {
                        student_name: (rawMeta?.student_name || rawMeta?.name || '').toUpperCase(),
                        prn: rawMeta?.prn || '',
                        roll_no: cleanNumericRollNo(rawMeta?.roll_no || rawMeta?.roll_number || rawMeta?.rollno || ''),
                        branch: rawMeta?.branch || '',
                        division: rawMeta?.division || '',
                        semester: rawMeta?.semester || '',
                        subject: rawMeta?.subject || ''
                    };

                    facultyBatchResults.push({
                        index: i,
                        filename: file.name,
                        fileSize: file.size,
                        image_b64: uploadRes.image_b64,
                        pages_b64: uploadRes.pages_b64 || [uploadRes.image_b64],
                        sections: sections,
                        metadata: metaObj,
                        marks_data: extractQuestionMarksFromGrid({ getSections: () => sections }),
                        is_verified: false,
                        is_submitted: false
                    });

                } catch (batchErr) {
                    console.error(`Error processing marksheet #${i + 1} (${file.name}):`, batchErr);
                    // Add fallback placeholder entry so the instructor can still manually input if needed
                    facultyBatchResults.push({
                        index: i,
                        filename: file.name,
                        fileSize: file.size,
                        image_b64: null,
                        pages_b64: [],
                        sections: [],
                        metadata: { student_name: '', prn: '', roll_no: '', branch: '', division: '', semester: '', subject: '' },
                        marks_data: {},
                        is_verified: false,
                        is_submitted: false,
                        error: batchErr.message
                    });
                }
            }

            hideLoading();

            if (facultyBatchResults.length > 0) {
                currentBatchIndex = 0;
                renderBatchStepper();
                loadBatchStudent(0);

                if (facultyResultCard) {
                    facultyResultCard.style.display = 'block';
                    facultyResultCard.scrollIntoView({ behavior: 'smooth' });
                }

                showToast(
                    'Extraction Completed! 🎉',
                    `Extracted ${facultyBatchResults.length} marksheet(s). You can now verify each student one by one before submitting.`
                );
            }
        });
    }

    // ------------------------------------------------------------------
    // Verification Carousel & Back-and-Forth Navigation
    // ------------------------------------------------------------------
    function saveCurrentBatchStudentEdits() {
        if (!facultyBatchResults || facultyBatchResults.length === 0) return;
        if (currentBatchIndex < 0 || currentBatchIndex >= facultyBatchResults.length) return;

        const currentItem = facultyBatchResults[currentBatchIndex];
        currentItem.metadata = getFacultyEditedMetadata();
        currentItem.sections = facultySpreadsheetEditor.getSections();
        currentItem.marks_data = extractQuestionMarksFromGrid(facultySpreadsheetEditor);
    }

    function renderBatchStepper() {
        if (!batchStepperContainer) return;
        batchStepperContainer.innerHTML = '';

        facultyBatchResults.forEach((item, idx) => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'batch-stepper-pill';

            if (idx === currentBatchIndex) pill.classList.add('active');
            if (item.is_submitted) pill.classList.add('submitted');
            else if (item.is_verified) pill.classList.add('verified');

            let statusIcon = '';
            if (item.is_submitted) {
                statusIcon = '<i class="fa-solid fa-cloud-arrow-up"></i> ';
            } else if (item.is_verified) {
                statusIcon = '<i class="fa-solid fa-circle-check"></i> ';
            }

            const rollLabel = item.metadata.roll_no ? `Roll ${item.metadata.roll_no}` : `Sheet ${idx + 1}`;
            pill.innerHTML = `${statusIcon}${rollLabel}`;

            pill.addEventListener('click', () => {
                loadBatchStudent(idx, true);
            });

            batchStepperContainer.appendChild(pill);
        });

        if (lblBatchUploadAllCount) {
            lblBatchUploadAllCount.innerText = String(facultyBatchResults.length);
        }
    }

    function loadBatchStudent(targetIndex, scrollToTop = false) {
        if (!facultyBatchResults || facultyBatchResults.length === 0) return;

        // 1. Save current student's edited state before switching
        saveCurrentBatchStudentEdits();

        // 2. Bound index
        if (targetIndex < 0) targetIndex = 0;
        if (targetIndex >= facultyBatchResults.length) targetIndex = facultyBatchResults.length - 1;
        currentBatchIndex = targetIndex;

        const item = facultyBatchResults[targetIndex];

        // 3. Render metadata banner
        renderFacultyStudentMetadata(item.metadata);

        // 4. Render spreadsheet grid
        facultySpreadsheetEditor.setSections(item.sections || []);

        // 5. Update Scan Image Reference
        if (batchScanImg && item.image_b64) {
            batchScanImg.src = item.image_b64;
            if (batchImagePreviewCard) batchImagePreviewCard.style.display = 'block';
        }

        // 6. Update Carousel Navigation Header
        if (batchCurrentIndexLabel) batchCurrentIndexLabel.innerText = String(targetIndex + 1);
        if (batchTotalCountLabel) batchTotalCountLabel.innerText = String(facultyBatchResults.length);
        if (batchCurrentStudentName) batchCurrentStudentName.innerText = item.metadata.student_name || `Student ${targetIndex + 1}`;
        if (batchCurrentStudentRoll) batchCurrentStudentRoll.innerText = item.metadata.roll_no || '--';

        // 7. Update Verification Status Badge
        if (batchVerifyBadge) {
            if (item.is_submitted) {
                batchVerifyBadge.className = 'batch-verify-status-badge submitted';
                batchVerifyBadge.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Saved in Database';
            } else if (item.is_verified) {
                batchVerifyBadge.className = 'batch-verify-status-badge verified';
                batchVerifyBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Verified';
            } else {
                batchVerifyBadge.className = 'batch-verify-status-badge pending';
                batchVerifyBadge.innerHTML = '<i class="fa-solid fa-clock"></i> Pending Verification';
            }
        }

        // 8. Navigation Buttons State
        if (btnBatchPrevStudent) btnBatchPrevStudent.disabled = (targetIndex === 0);
        if (btnBatchNextStudent) btnBatchNextStudent.disabled = (targetIndex === facultyBatchResults.length - 1);

        // 9. Update Stepper Pills
        renderBatchStepper();

        // 10. Scroll smoothly up to metadata banner to view new student details
        if (scrollToTop) {
            const scrollTarget = document.getElementById('facultyMetadataBannerCard') || document.getElementById('facultyResultCard');
            if (scrollTarget) {
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    if (btnBatchPrevStudent) {
        btnBatchPrevStudent.addEventListener('click', () => {
            if (currentBatchIndex > 0) {
                loadBatchStudent(currentBatchIndex - 1, true);
            }
        });
    }

    if (btnBatchNextStudent) {
        btnBatchNextStudent.addEventListener('click', () => {
            if (currentBatchIndex < facultyBatchResults.length - 1) {
                loadBatchStudent(currentBatchIndex + 1, true);
            }
        });
    }

    if (btnBatchVerifyAndNext) {
        btnBatchVerifyAndNext.addEventListener('click', () => {
            if (!facultyBatchResults || facultyBatchResults.length === 0) return;

            saveCurrentBatchStudentEdits();
            const currentItem = facultyBatchResults[currentBatchIndex];
            currentItem.is_verified = true;

            showToast(
                'Student Verified ✔️',
                `${currentItem.metadata.student_name || 'Student'} (Roll: ${currentItem.metadata.roll_no || currentBatchIndex + 1}) marked as verified.`
            );

            // Move to next student if available
            if (currentBatchIndex < facultyBatchResults.length - 1) {
                loadBatchStudent(currentBatchIndex + 1, true);
            } else {
                loadBatchStudent(currentBatchIndex);
                showToast(
                    'All Students Verified! 🎯',
                    'You have verified the last marksheet. You can now click "Commit All to Database" to upload everything.'
                );
            }
        });
    }

    // ------------------------------------------------------------------
    // Batch Database Submission ("Once done for all then upload")
    // ------------------------------------------------------------------
    if (btnFacultySubmitAllToDb) {
        btnFacultySubmitAllToDb.addEventListener('click', async () => {
            if (!facultyBatchResults || facultyBatchResults.length === 0) {
                alert('No extracted marksheets found to submit.');
                return;
            }

            saveCurrentBatchStudentEdits();

            const classroomId = facultyUploadClassroomSelect ? facultyUploadClassroomSelect.value : (facultyClassroomSelect ? facultyClassroomSelect.value : '');
            if (!classroomId) {
                alert('Please select a target classroom batch before committing.');
                return;
            }

            // Check if any marksheets are completely empty
            const invalidEntries = facultyBatchResults.filter(item => !item.metadata.student_name && !item.metadata.roll_no && !item.metadata.prn);
            if (invalidEntries.length > 0) {
                const proceed = confirm(`${invalidEntries.length} marksheet(s) have missing student details (Name / Roll No). Would you like to commit the batch anyway?`);
                if (!proceed) return;
            }

            showLoading(
                'Submitting All Marksheets...',
                `Committing ${facultyBatchResults.length} student records to MongoDB Atlas...`
            );

            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < facultyBatchResults.length; i++) {
                const item = facultyBatchResults[i];
                showLoading(
                    `Uploading to MongoDB (${i + 1} of ${facultyBatchResults.length})`,
                    `Saving: ${item.metadata.student_name || 'Student'} (Roll: ${item.metadata.roll_no || '--'})...`
                );

                try {
                    const marksData = item.marks_data && Object.keys(item.marks_data).length > 0
                        ? item.marks_data
                        : extractQuestionMarksFromGrid({ getSections: () => item.sections });

                    const res = await safeFetchJson('/api/submissions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            classroom_id: classroomId,
                            student_metadata: item.metadata,
                            marks_data: marksData,
                            raw_image_b64: item.image_b64,
                            is_faculty: true
                        })
                    });

                    if (res.status === 'success') {
                        item.is_submitted = true;
                        item.is_verified = true;
                        successCount++;
                    } else {
                        errorCount++;
                    }
                } catch (subErr) {
                    console.error(`Failed to submit marksheet #${i + 1}:`, subErr);
                    errorCount++;
                }
            }

            hideLoading();
            loadFacultyRoster();

            if (errorCount === 0) {
                resetFacultyUploadState();
                showToast(
                    'All Marksheets Uploaded! 🎉',
                    `Successfully saved all ${successCount} student marksheets to MongoDB Atlas class roster.`
                );
            } else {
                loadBatchStudent(currentBatchIndex);
                alert(`Batch submission finished: ${successCount} saved, ${errorCount} failed. Please review unsubmitted sheets.`);
            }
        });
    }

    // Submit Current Student Only
    if (btnFacultySubmitToDb) {
        btnFacultySubmitToDb.addEventListener('click', async () => {
            saveCurrentBatchStudentEdits();

            const classroomId = facultyUploadClassroomSelect ? facultyUploadClassroomSelect.value : (facultyClassroomSelect ? facultyClassroomSelect.value : '');
            if (!classroomId) {
                alert('Please select a target classroom batch before committing.');
                return;
            }

            const currentMeta = getFacultyEditedMetadata();
            const questionMarks = extractQuestionMarksFromGrid(facultySpreadsheetEditor);

            if (!currentMeta.student_name && !currentMeta.prn && !currentMeta.roll_no) {
                alert('Please verify student metadata (Name / Roll No / PRN) before committing.');
                return;
            }

            showLoading('Saving to Class Roster', 'Committing marksheet directly to MongoDB Atlas...');

            try {
                const currentItem = facultyBatchResults[currentBatchIndex];
                const rawImg = currentItem ? currentItem.image_b64 : (currentFacultyUploadedData ? currentFacultyUploadedData.image_b64 : null);

                const data = await safeFetchJson('/api/submissions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        classroom_id: classroomId,
                        student_metadata: currentMeta,
                        marks_data: questionMarks,
                        raw_image_b64: rawImg,
                        is_faculty: true
                    })
                });

                hideLoading();

                if (data.status === 'success') {
                    if (currentItem) {
                        currentItem.is_submitted = true;
                        currentItem.is_verified = true;
                    }
                    showToast(
                        'Saved to Class Roster! 🎉',
                        `${currentMeta.student_name || 'Student'} (Roll: ${currentMeta.roll_no}) saved directly to MongoDB Atlas.`
                    );

                    loadFacultyRoster();
                    renderBatchStepper();

                    // If all sheets are now submitted, return to initial upload state
                    const allSubmitted = facultyBatchResults.length > 0 && facultyBatchResults.every(item => item.is_submitted);
                    if (allSubmitted) {
                        setTimeout(() => {
                            resetFacultyUploadState();
                            showToast('Batch Complete! 🎉', 'All marksheets have been verified and saved to MongoDB Atlas.');
                        }, 1200);
                    } else {
                        loadBatchStudent(currentBatchIndex);
                    }
                } else {
                    alert(`Submission error: ${data.detail || 'Could not save marksheet'}`);
                }
            } catch (err) {
                hideLoading();
                alert(`Failed to save to database: ${err.message}`);
            }
        });
    }

    // Reset Faculty Upload State back to initial view
    function resetFacultyUploadState() {
        facultySelectedFiles = [];
        facultyBatchResults = [];
        currentBatchIndex = 0;
        currentFacultyUploadedData = null;

        if (facultyFileInput) facultyFileInput.value = '';
        if (facultyCameraInput) facultyCameraInput.value = '';

        renderFacultyBatchQueue();

        if (facultyDropZone) facultyDropZone.style.display = 'block';
        if (facultyFilePreviewBar) facultyFilePreviewBar.style.display = 'none';
        if (facultyCropControlStrip) facultyCropControlStrip.style.display = 'none';
        if (facultyPageCropPreviewCard) facultyPageCropPreviewCard.style.display = 'none';
        if (facultyBatchQueueContainer) facultyBatchQueueContainer.style.display = 'none';
        if (facultyResultCard) facultyResultCard.style.display = 'none';

        if (btnFacultyConvert) {
            btnFacultyConvert.disabled = true;
            btnFacultyConvert.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Convert & Extract Numbers';
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Upload New Batch Button
    const btnFacultyNewBatch = document.getElementById('btnFacultyNewBatch');
    if (btnFacultyNewBatch) {
        btnFacultyNewBatch.addEventListener('click', () => {
            if (confirm('Clear current batch workspace and upload new marksheets?')) {
                resetFacultyUploadState();
                showToast('Workspace Reset', 'Ready to upload a new batch of marksheets.');
            }
        });
    }

    // Faculty Single Marksheet Excel & CSV Exports
    if (btnFacultySingleExportExcel) {
        btnFacultySingleExportExcel.addEventListener('click', async () => {
            const sections = facultySpreadsheetEditor.getSections();
            if (!sections || sections.length === 0) return;

            showLoading('Generating Excel File', 'Formatting worksheets & auto-fitting columns...');
            const currentMeta = getFacultyEditedMetadata();

            try {
                const res = await fetch('/api/export/excel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sections: sections, metadata: currentMeta })
                });

                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `marksheet_${currentMeta.roll_no || 'student'}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } else {
                    alert('Failed to download Excel file.');
                }
            } catch (err) {
                alert(`Export error: ${err.message}`);
            } finally {
                hideLoading();
            }
        });
    }

    if (btnFacultySingleExportCsv) {
        btnFacultySingleExportCsv.addEventListener('click', async () => {
            const sections = facultySpreadsheetEditor.getSections();
            if (!sections || sections.length === 0) return;

            showLoading('Generating CSV File', 'Creating clean CSV...');
            const currentMeta = getFacultyEditedMetadata();

            try {
                const res = await fetch('/api/export/csv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sections: sections, metadata: currentMeta })
                });

                if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `marksheet_${currentMeta.roll_no || 'student'}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } else {
                    alert('Failed to download CSV file.');
                }
            } catch (err) {
                alert(`Export error: ${err.message}`);
            } finally {
                hideLoading();
            }
        });
    }

    // Faculty Grid Toolbar buttons
    if (btnAddFacultyRow) btnAddFacultyRow.addEventListener('click', () => facultySpreadsheetEditor.addRow());
    if (btnAddFacultyCol) btnAddFacultyCol.addEventListener('click', () => facultySpreadsheetEditor.addColumn());
    if (btnClearFacultyGrid) {
        btnClearFacultyGrid.addEventListener('click', () => {
            if (confirm('Clear current faculty spreadsheet grid?')) {
                facultySpreadsheetEditor.clearGrid();
            }
        });
    }

    // Initial Load
    loadClassrooms();
});
