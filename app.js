// ⭐⭐⭐ 1. CONFIGURATION: REPLACE THIS WITH YOUR GOOGLE CLOUD CLIENT ID ⭐⭐⭐
const CLIENT_ID = '887069703934-o2thfso17bur08q3novje0meenf13l0v.apps.googleusercontent.com'; 

// --- Google API and App Configuration ---
const SCOPES = 'https://www.googleapis.com/auth/drive.file'; 
const FOLDER_NAME = "HR_Attendance_Data"; 
const FILE_MIMETYPE = 'text/plain'; 

let gapiInited = false;
let gisInited = false;
let tokenClient;

// --- 2. INITIALIZATION AND AUTHENTICATION ---

// Called when the gapi.js script is fully loaded
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

// Initialize GAPI client and check for existing token
async function initializeGapiClient() {
    await gapi.client.init({});
    gapiInited = true;
    checkState();
}

// Initialize Google Identity Services (GIS) client for OAuth
function initializeGisClient() {
    // This function relies on the correct client.js script being loaded
    tokenClient = google.accounts.oauth2.initCodeClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error !== undefined) {
                console.error('Authorization failed:', resp);
                document.getElementById('status_message').innerText = '❌ Authorization Failed.';
                return;
            }
            // Token received, user is authorized
            gapi.client.setToken(resp);
            checkState();
        },
    });
    gisInited = true;
    checkState();
}

// Check if both libraries are loaded and update UI state
function checkState() {
    if (gapiInited && gisInited) {
        const storedToken = gapi.client.getToken();
        const isAuthorized = storedToken && storedToken.access_token;

        // Make sure these lines are exactly as shown:
        document.getElementById('authorize_button').style.display = isAuthorized ? 'none' : 'block';
        document.getElementById('signout_button').style.display = isAuthorized ? 'block' : 'none';
        document.getElementById('data_form').style.display = isAuthorized ? 'block' : 'none';
        
        // ... rest of the status message logic ...
        
        if (isAuthorized) {
            document.getElementById('status_message').innerText = '✅ Authorized to save data.';
            document.getElementById('status_message').classList.add('success');
        } else if (gapiInited && gisInited) {
            document.getElementById('status_message').innerText = 'Please click "Authorize Google Drive" to start.';
            document.getElementById('status_message').classList.remove('success');
        }
    }
}

// Attach event listeners when the window loads
window.onload = function() {
    document.getElementById('authorize_button').onclick = handleAuthClick;
    document.getElementById('signout_button').onclick = handleSignoutClick;
    document.getElementById('save_button').onclick = handleSaveClick;
    // GIS initialization is triggered by the HTML script load (initializeGisClient)
};

// Initiate the Google OAuth authorization flow
function handleAuthClick() {
    // This is the function that was previously failing
    if (tokenClient) {
        tokenClient.requestAccessToken();
    } else {
        console.error("tokenClient is not defined. GIS script likely failed to load.");
    }
}

// Sign out the user and revoke the token
function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Revocation successful');
            gapi.client.setToken(null);
            checkState(); // Update UI
        });
    }
}

// --- 3. ENCRYPTION AND UPLOAD LOGIC ---

/**
 * Encrypts the raw data string using AES-256 with a strong password.
 */
function encryptData(rawData, password) {
    const encrypted = CryptoJS.AES.encrypt(rawData, password).toString();
    return encrypted;
}

// Main handler for saving data
async function handleSaveClick() {
    const statusEl = document.getElementById('status_message');
    statusEl.innerText = 'Processing... Please wait.';
    statusEl.classList.remove('success');

    const name = document.getElementById('employee_name').value.trim();
    const shift = document.getElementById('shift').value;
    const hours = document.getElementById('hours').value;
    const password = document.getElementById('password').value.trim();

    if (!name || !shift || !hours || !password) {
        statusEl.innerText = '❌ Please fill in all fields.';
        return;
    }

    try {
        // 1. Format data for CSV
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // CSV Format: Date,Employee Name,Shift,Hours Worked
        const rawData = `${today},"${name}","${shift}",${hours}\n`;
        
        // 2. Encrypt the data
        const encryptedContent = encryptData(rawData, password);

        // 3. Upload the encrypted data to Google Drive
        await uploadFileToDrive(encryptedContent);
        
        statusEl.innerText = '✅ Data saved successfully to Google Drive!';
        statusEl.classList.add('success');
        
        // Clear form fields except password
        document.getElementById('employee_name').value = '';
        document.getElementById('hours').value = '';

    } catch (error) {
        console.error('Save failed:', error);
        statusEl.innerText = `❌ Error saving data. Please check console.`;
        statusEl.classList.remove('success');
    }
}


/**
 * Uploads the encrypted data as a file with a custom extension to Google Drive.
 */
async function uploadFileToDrive(encryptedContent) {
    const FILE_NAME = `attendance_entry_${Date.now()}.vocos`; 

    // 1. Find or Create the target folder
    let folderId = await findOrCreateFolder(FOLDER_NAME);

    // 2. Prepare metadata and file content (Blob)
    const file = new Blob([encryptedContent], { type: FILE_MIMETYPE });
    const metadata = {
        name: FILE_NAME,
        mimeType: FILE_MIMETYPE,
        ...(folderId && { parents: [folderId] }) 
    };

    // 3. Use FormData for multipart upload
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + gapi.client.getToken().access_token
        },
        body: form
    });

    if (!response.ok) {
        const errorText = await response.text();
        // Check for specific authorization errors
        if (response.status === 401) {
            throw new Error(`Authorization required. Please sign out and re-authorize.`);
        }
        throw new Error(`Drive Upload Failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;
}


/**
 * Helper function to find or create a specific folder in Google Drive.
 */
async function findOrCreateFolder(folderName) {
    const q = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    
    // 1. Search for the folder
    const searchResponse = await gapi.client.drive.files.list({
        q: q,
        spaces: 'drive',
        fields: 'files(id)'
    });

    if (searchResponse.result.files.length > 0) {
        return searchResponse.result.files[0].id;
    }

    // 2. If not found, create it
    const createResponse = await gapi.client.drive.files.create({
        resource: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
    });

    return createResponse.result ? createResponse.result.id : null;
}
