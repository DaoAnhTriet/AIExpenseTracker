import { DriveData } from "../types";

/**
 * Find the backup file "expense_tracker_sync_data.json" in the user's Google Drive.
 * @param token The OAuth 2.0 access token
 * @returns The file ID of the backup, or null if not found
 */
export async function findBackupFile(token: string): Promise<string | null> {
  try {
    const q = encodeURIComponent("name = 'expense_tracker_sync_data.json' and trashed = false");
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
      throw new Error(`Drive list error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    return null;
  } catch (error) {
    console.error("Error finding backup file in Google Drive:", error);
    return null;
  }
}

/**
 * Download the backup data from the specified Google Drive file.
 * @param token The OAuth 2.0 access token
 * @param fileId The Google Drive file ID
 * @returns The DriveData parsed from the JSON file
 */
export async function downloadBackupFile(token: string, fileId: string): Promise<DriveData | null> {
  try {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
      throw new Error(`Drive download error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data as DriveData;
  } catch (error) {
    console.error("Error downloading backup file from Google Drive:", error);
    return null;
  }
}

/**
 * Create a new backup file "expense_tracker_sync_data.json" in Google Drive.
 * @param token The OAuth 2.0 access token
 * @param appData The DriveData payload to upload
 * @returns The newly created file ID, or null if failed
 */
export async function createBackupFile(token: string, appData: DriveData): Promise<string | null> {
  try {
    // Stage 1: Create metadata to get fileId
    const metadataResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "expense_tracker_sync_data.json",
        mimeType: "application/json"
      })
    });
    
    if (!metadataResponse.ok) {
      throw new Error(`Drive metadata creation failed: ${metadataResponse.status} ${metadataResponse.statusText}`);
    }
    
    const metadata = await metadataResponse.json();
    const fileId = metadata.id;

    // Stage 2: Upload content using fileId upload endpoint
    const uploadResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(appData, null, 2)
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`Drive file content upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }
    
    return fileId;
  } catch (error) {
    console.error("Error creating backup file in Google Drive:", error);
    return null;
  }
}

/**
 * Update the existing backup file with new data.
 * @param token The OAuth 2.0 access token
 * @param fileId The existing Google Drive file ID
 * @param appData The DriveData payload to save
 * @returns boolean indicating success status
 */
export async function updateBackupFile(token: string, fileId: string, appData: DriveData): Promise<boolean> {
  try {
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(appData, null, 2)
    });
    
    if (!response.ok) {
      throw new Error(`Drive file update failed: ${response.status} ${response.statusText}`);
    }
    
    return true;
  } catch (error) {
    console.error("Error updating backup file in Google Drive:", error);
    return false;
  }
}
