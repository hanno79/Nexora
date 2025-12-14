// Dart AI integration helper
// API Documentation: https://app.dartai.com/api/v0/public/docs/

const DART_API_BASE_URL = 'https://app.dartai.com/api/v0/public';

/**
 * Get Dart AI API key from environment secrets
 * Uses Replit's Secrets management for secure storage
 */
function getApiKey(): string {
  const apiKey = process.env.DART_AI_API_KEY;
  
  if (!apiKey) {
    throw new Error('Dart AI API key not configured. Please add DART_AI_API_KEY to your secrets.');
  }
  
  return apiKey;
}

/**
 * Make an authenticated request to Dart AI API
 */
async function dartApiRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  const apiKey = getApiKey();
  
  const url = `${DART_API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`, // Dart AI requires Bearer prefix despite dsa_ token format
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    
    // Handle non-JSON responses
    const contentType = response.headers.get('content-type');
    const responseText = await response.text();
    
    let data;
    if (contentType?.includes('application/json') && responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        data = { message: responseText };
      }
    } else {
      data = { message: responseText || 'No response body' };
    }

    if (!response.ok) {
      // Log full error response for debugging
      console.error(`Dart AI API error ${response.status}:`, JSON.stringify(data, null, 2));
      console.error('Request URL:', url);
      console.error('Request method:', method);
      if (body) console.error('Request body:', JSON.stringify(body, null, 2));
      
      // Handle specific HTTP error codes
      if (response.status === 401) {
        throw new Error('Dart AI authentication failed. Please check your API key.');
      }
      if (response.status === 403) {
        throw new Error('Dart AI access forbidden. Please verify your API key permissions.');
      }
      if (response.status === 404) {
        throw new Error('Dart AI endpoint not found. The API may have changed.');
      }
      if (response.status === 429) {
        throw new Error('Dart AI rate limit exceeded. Please try again later.');
      }
      if (response.status >= 500) {
        throw new Error('Dart AI server error. Please try again later.');
      }
      
      // For 400 errors, include the full error details
      const errorDetail = data.detail || data.message || data.error || JSON.stringify(data);
      throw new Error(`Dart AI API error ${response.status}: ${errorDetail}`);
    }

    return data;
  } catch (error: any) {
    // Network or parsing errors
    if (error.message?.includes('fetch')) {
      throw new Error('Failed to connect to Dart AI. Please check your internet connection.');
    }
    
    // Re-throw our custom errors
    throw error;
  }
}

/**
 * Export PRD to Dart AI as a new Doc
 * Returns the created doc ID and URL
 */
export async function exportToDart(
  title: string,
  content: string,
  folder?: string
): Promise<{ docId: string; url: string; folder: string }> {
  try {
    // Create a new doc in Dart AI
    // Dart AI API requires an "item" wrapper object
    const payload = {
      item: {
        title: title,
        text: content, // Dart AI uses 'text' field for markdown content
        folder: folder || 'General/Docs', // Use selected folder or default
      }
    };

    const response = await dartApiRequest('/docs', 'POST', payload);
    
    // Extract doc ID from response
    // Response format: { "item": { "id": "...", "htmlUrl": "...", ... } }
    const docId = response.item?.id;
    const htmlUrl = response.item?.htmlUrl;
    const docFolder = response.item?.folder;
    
    if (!docId) {
      console.error('Dart API response:', response);
      throw new Error('Dart AI did not return a doc ID. Response may have changed.');
    }

    // Use the htmlUrl from response or construct fallback
    const url = htmlUrl || `https://app.dartai.com/o/${docId}`;

    return {
      docId,
      url,
      folder: docFolder || folder || 'General/Docs',
    };
  } catch (error: any) {
    console.error('Error exporting to Dart AI:', error);
    
    // Handle specific Dart AI error types
    if (error.message?.includes('authentication') || error.message?.includes('API key')) {
      throw new Error('Dart AI authentication failed. Please check your DART_AI_API_KEY secret.');
    }
    
    if (error.message?.includes('rate limit')) {
      throw new Error('Dart AI rate limit exceeded. Please try again in a few minutes.');
    }
    
    if (error.message?.includes('forbidden') || error.message?.includes('permissions')) {
      throw new Error('Dart AI access denied. Please verify your API key has the correct permissions.');
    }
    
    // Generic error fallback
    throw new Error(`Failed to export to Dart AI: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Check if Dart AI connection is working
 * Returns true if API key is valid and connection is successful
 */
export async function checkDartConnection(): Promise<boolean> {
  try {
    // Check if API key exists
    getApiKey();
    
    // Verify connection by fetching user config
    // This is a lightweight endpoint that verifies authentication
    await dartApiRequest('/config', 'GET');
    
    return true;
  } catch (error) {
    console.error('Dart AI connection check failed:', error);
    return false;
  }
}

/**
 * Update an existing Dart AI doc
 * Uses PUT endpoint to sync content changes
 * Note: Dart AI Update uses WrappedDocUpdate format - same as create with item wrapper
 * Based on API docs: PUT /docs/{id} with { item: { title?, text? } }
 */
export async function updateDartDoc(
  docId: string,
  title: string,
  content: string
): Promise<{ docId: string; url: string }> {
  try {
    // Dart AI Update requires the doc ID inside the item object
    // Error was: "item.id: This field is required."
    const payload = {
      item: {
        id: docId,  // Required for updates!
        title: title,
        text: content,
      }
    };

    console.log('Dart AI Update - docId:', docId);
    console.log('Dart AI Update - payload:', JSON.stringify(payload, null, 2));

    const response = await dartApiRequest(`/docs/${docId}`, 'PUT', payload);
    
    console.log('Dart AI Update response:', JSON.stringify(response, null, 2));
    
    // Extract doc info from response
    const updatedDoc = response.item;
    if (!updatedDoc) {
      // If no item in response, the update may have succeeded but with different response format
      // Try to construct the URL from the docId
      console.log('No item in response, using docId for URL');
      return {
        docId: docId,
        url: `https://app.dartai.com/o/${docId}`,
      };
    }

    const url = updatedDoc.htmlUrl || `https://app.dartai.com/o/${docId}`;

    return {
      docId: updatedDoc.id || docId,
      url,
    };
  } catch (error: any) {
    console.error('Error updating Dart AI doc:', error);
    console.error('Error details:', error.message);
    
    if (error.message?.includes('authentication') || error.message?.includes('API key')) {
      throw new Error('Dart AI authentication failed. Please check your DART_AI_API_KEY secret.');
    }
    
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      throw new Error('Document not found in Dart AI. It may have been deleted.');
    }
    
    // If 400 error, try to provide more context
    if (error.message?.includes('400')) {
      throw new Error('Dart AI rejected the update request. The document format may be invalid or the document may no longer exist.');
    }
    
    throw new Error(`Failed to update Dart AI doc: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get a Dart AI doc by ID
 * Optional utility function for future enhancements
 */
export async function getDartDoc(docId: string): Promise<any> {
  try {
    const response = await dartApiRequest(`/docs/${docId}`, 'GET');
    
    // Response format: { "item": { "id": "...", "title": "...", "text": "...", ... } }
    const doc = response.item;
    if (!doc) {
      throw new Error(`Doc ${docId} not found`);
    }

    return {
      id: doc.id,
      title: doc.title,
      text: doc.text,
      url: doc.htmlUrl || `https://app.dartai.com/o/${doc.id}`,
      folder: doc.folder,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  } catch (error: any) {
    console.error('Error fetching Dart AI doc:', error);
    throw new Error(`Failed to fetch Dart AI doc: ${error.message}`);
  }
}

/**
 * Get list of available Dartboards and Folders from Dart AI
 * Returns dartboards and folders available in user's workspace
 */
export async function getDartboards(): Promise<{ dartboards: string[]; folders: string[] }> {
  try {
    // Get user config which includes available dartboards and folders
    const response = await dartApiRequest('/config', 'GET');
    
    // Response format: { "dartboards": ["Space/Dartboard", ...], "folders": ["Space/Folder", ...], ... }
    const dartboards = response.dartboards || [];
    const folders = response.folders || [];
    
    return {
      dartboards,
      folders,
    };
  } catch (error: any) {
    console.error('Error fetching Dart AI dartboards:', error);
    throw new Error(`Failed to fetch Dart AI dartboards: ${error.message}`);
  }
}
