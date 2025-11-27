// ⭐⭐⭐ 1. CONFIGURATION: REPLACE THIS WITH YOUR GOOGLE CLOUD CLIENT ID ⭐⭐⭐
const CLIENT_ID = 'YOUR_GOOGLE_CLOUD_CLIENT_ID'; 

// --- Google API and App Configuration ---
const SCOPES = 'https://www.googleapis.com/auth/drive.file'; 
const FOLDER_NAME = "HR_Attendance_Data"; // Folder where files will be saved
const FILE_MIMETYPE = 'text/plain'; // Encrypted CSV will be saved as a plain text file

let gapiInited = false;
let gisInited = false;
let tokenClient;

// --- 2. INITIALIZATION AND AUTHENTICATION ---

// Step 1: Called when the gapi.js script is fully loaded
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

// Step 2: Initialize GAPI client and check for existing token
async function initializeGapiClient() {
    await gapi.client.init({});
    gapiInited = true;
    checkState();
}

// Step 3: Initialize Google Identity Services (GIS) client for OAuth
function initializeGisClient() {
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
        
        if (storedToken && storedToken.access_token) {
            // User is authorized
            document.getElementById('authorize_button').style.display = 'none';
            document.getElementById('signout_button').style.display = 'block';
            document.getElementById('data_form').style.display = 'block';
            document.getElementById('status_message').innerText = '✅ Authorized to save data.';
            document.getElementById('status_message').classList.add('success');
        } else {
            // User needs to authorize
            document.getElementById('authorize_button').style.display = 'block';
            document.getElementById('signout_button').style.display = 'none';
            document.getElementById('data_form').style.display = 'none';
            document.getElementById('status_message').innerText = '';
        }
    }
}

// Attach event listeners when the window loads
window.onload = function() {
    document.getElementById('authorize_button').onclick = handleAuthClick;
    document.getElementById('signout_button').onclick = handleSignoutClick;
    document.getElementById('save_button').onclick = handleSaveClick;
};

// Initiate the Google OAuth authorization flow
function handleAuthClick() {
    tokenClient.requestAccessToken();
}

// Sign out the user and revoke the token
function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        // Revoke token access from the user's Google account
        google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Revocation successful');
            gapi.client.setToken(null);
            document.getElementById('status_message').innerText = 'Signed out. Please authorize again to save data.';
            document.getElementById('status_message').classList.remove('success');
            checkState(); // Update UI
        });
    }
}

// --- 3. ENCRYPTION AND UPLOAD LOGIC ---

/**
 * Encrypts the raw data string using AES-256 with a strong password.
 * @param {string} rawData - The CSV formatted data string.
 * @param {string} password - The strong password/key for encryption.
 * @returns {string} The encrypted data (Base64 encoded ciphertext).
 */
function encryptData(rawData, password) {
    // CryptoJS uses the password to derive the key and salt internally for AES-256
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
        statusEl.innerText = '❌ Please fill in all fields (Name, Shift, Hours, and Encryption Key).';
        return;
    }

    try {
        // 1. Format data for CSV
        // In a real application, you would append to an existing encrypted file, 
        // but for this static site upload, we save a new entry.
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // CSV Format: Date,Employee Name,Shift,Hours Worked
        const rawData = `${today},"${name}","${shift}",${hours}\n`;
        
        // 2. Encrypt the data
        const encryptedContent = encryptData(rawData, password);

        // 3. Upload the encrypted data to Google Drive
        await uploadFileToDrive(encryptedContent);
        
        statusEl.innerText = '✅ Data saved successfully to Google Drive!';
        statusEl.classList.add('success');
        
        // Clear form fields except password (as it might be reused)
        document.getElementById('employee_name').value = '';
        document.getElementById('hours').value = '';

    } catch (error) {
        console.error('Save failed:', error);
        statusEl.innerText = `❌ Error saving data: ${error.message}. Please check console and try authorizing again.`;
        statusEl.classList.remove('success');
    }
}


/**
 * Uploads the encrypted data as a file with a custom extension to Google Drive.
 * @param {string} encryptedContent - The content to be saved in the file.
 */
async function uploadFileToDrive(encryptedContent) {
    // Generate a unique file name with the custom extension
    const FILE_NAME = `attendance_entry_${Date.now()}.vocos`; 

    // 1. Find or Create the target folder
    let folderId = await findOrCreateFolder(FOLDER_NAME);

    // 2. Prepare metadata and file content (Blob)
    const file = new Blob([encryptedContent], { type: FILE_MIMETYPE });
    const metadata = {
        name: FILE_NAME,
        mimeType: FILE_MIMETYPE,
        ...(folderId && { parents: [folderId] }) // Assign to the folder if found/created
    };

    // 3. Use FormData for multipart upload
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    // 4. Send the POST request to the Google Drive Upload API
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + gapi.client.getToken().access_token
        },
        body: form
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Drive Upload Failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`File uploaded. ID: ${result.id}, Link: ${result.webViewLink}`);
    return result;
}


/**
 * Helper function to find or create a specific folder in Google Drive.
 * @param {string} folderName - The name of the folder.
 * @returns {Promise<string|null>} The folder ID.
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
