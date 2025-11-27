// ⭐ CONFIGURATION
const CLIENT_ID = '887069703934-o2thfso17bur08q3novje0meenf13l0v.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

// Global variables
let tokenClient;
let gapiInited = false;
let gisInited = false;

// 1. Load GAPI (Google API Client)
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeEnableButtons();
}

// 2. Load GIS (Google Identity Services)
function initializeGisClient() {
    tokenClient = google.accounts.oauth2.initCodeClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error !== undefined) {
                console.error("Auth Error:", resp);
                return;
            }
            // Save token to GAPI client
            gapi.client.setToken(resp);
            maybeEnableButtons();
        },
    });
    gisInited = true;
    maybeEnableButtons();
}

// 3. UI Logic
function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        // Check if we already have a valid token
        const token = gapi.client.getToken();
        const isAuthorized = token && token.access_token;

        if (isAuthorized) {
            document.getElementById('authorize_button').style.display = 'none';
            document.getElementById('auth_instruction').style.display = 'none';
            document.getElementById('signout_button').style.display = 'block';
            document.getElementById('data_form').style.display = 'block';
            document.getElementById('status_message').innerText = "✅ Authorized";
            document.getElementById('status_message').className = "status-message success";
        } else {
            document.getElementById('authorize_button').style.display = 'block';
            document.getElementById('auth_instruction').style.display = 'block';
            document.getElementById('signout_button').style.display = 'none';
            document.getElementById('data_form').style.display = 'none';
        }
    }
}

// 4. Event Handlers
function handleAuthClick() {
    if (tokenClient) {
        // Request authorization
        tokenClient.requestAccessToken();
    } else {
        console.error('Google Identity Services not initialized yet.');
        alert('System loading... please wait a moment and try again.');
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken(null); // Clear token
            document.getElementById('status_message').innerText = "Signed out";
            document.getElementById('status_message').className = "status-message";
            maybeEnableButtons(); // Update UI
        });
    }
}

async function handleSaveClick() {
    const statusEl = document.getElementById('status_message');
    statusEl.innerText = 'Encrypting and Uploading...';
    statusEl.className = 'status-message';

    const name = document.getElementById('employee_name').value;
    const shift = document.getElementById('shift').value;
    const hours = document.getElementById('hours').value;
    const password = document.getElementById('password').value;

    if (!name || !shift || !hours || !password) {
        statusEl.innerText = '❌ Please fill all fields.';
        statusEl.className = 'status-message error';
        return;
    }

    try {
        // A. Create CSV String
        const date = new Date().toISOString().split('T')[0];
        const csvData = `Date,Name,Shift,Hours\n${date},"${name}","${shift}",${hours}`;

        // B. Encrypt with AES-256 (CryptoJS)
        const encrypted = CryptoJS.AES.encrypt(csvData, password).toString();

        // C. Upload to Drive
        await uploadFileToDrive(encrypted);

        statusEl.innerText = '✅ Saved securely to Google Drive!';
        statusEl.className = 'status-message success';
        
        // Clear inputs
        document.getElementById('employee_name').value = '';
        document.getElementById('hours').value = '';
    } catch (err) {
        console.error(err);
        statusEl.innerText = '❌ Error saving file. See console.';
        statusEl.className = 'status-message error';
    }
}

// 5. Drive Upload Helper
async function uploadFileToDrive(content) {
    const fileName = `attendance_${Date.now()}.vocos`;
    const folderName = "HR_Attendance_Data";

    // Find or create folder
    let folderId = null;
    const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
    const search = await gapi.client.drive.files.list({ q: q, fields: 'files(id)' });
    
    if (search.result.files.length > 0) {
        folderId = search.result.files[0].id;
    } else {
        const newFolder = await gapi.client.drive.files.create({
            resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id'
        });
        folderId = newFolder.result.id;
    }

    // Prepare multipart upload
    const metadata = {
        name: fileName,
        mimeType: 'text/plain',
        parents: [folderId]
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'text/plain' }));

    const accessToken = gapi.client.getToken().access_token;
    
    await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
        body: form
    });
}

// Bind events on load
window.onload = function() {
    document.getElementById('authorize_button').onclick = handleAuthClick;
    document.getElementById('signout_button').onclick = handleSignoutClick;
    document.getElementById('save_button').onclick = handleSaveClick;
};
