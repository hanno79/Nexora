// Dart AI integration helper
// API Documentation: https://app.dartai.com/api/v0/public/docs/

import { logger } from "./logger";

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
      const requestBodySize = body ? JSON.stringify(body).length : 0;
      const responseKeys = data && typeof data === "object" ? Object.keys(data) : [];

      // Log sanitized error metadata only (no payload/content dumps)
      logger.error('Dart AI API error', {
        status: response.status,
        endpoint,
        method,
        responseKeys,
        requestBodySize,
      });
      
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
      logger.error('Dart AI did not return a doc ID', {
        responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
      });
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
    logger.error('Error exporting to Dart AI', { error: error.message });
    
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
    logger.error('Dart AI connection check failed', { error: (error as Error).message });
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

    logger.info('Dart AI Update request', {
      docId,
      titleLength: title.length,
      contentLength: content.length,
    });

    const response = await dartApiRequest(`/docs/${docId}`, 'PUT', payload);

    logger.info('Dart AI Update response', {
      docId,
      hasItem: !!response?.item,
      responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
    });
    
    // Extract doc info from response
    const updatedDoc = response.item;
    if (!updatedDoc) {
      // If no item in response, the update may have succeeded but with different response format
      // Try to construct the URL from the docId
      logger.info('No item in response, using docId for URL', { docId });
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
    logger.error('Error updating Dart AI doc', { docId, error: error.message });
    
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
    logger.error('Error fetching Dart AI doc', { docId, error: error.message });
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
    logger.error('Error fetching Dart AI dartboards', { error: error.message });
    throw new Error(`Failed to fetch Dart AI dartboards: ${error.message}`);
  }
}
