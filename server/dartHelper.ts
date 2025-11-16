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
      
      throw new Error(data.message || data.error || `Dart AI API error: ${response.status}`);
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
  content: string
): Promise<{ docId: string; url: string }> {
  try {
    // Create a new doc in Dart AI
    // According to API docs: POST /docs creates a new doc
    const payload = {
      data: {
        title: title,
        text: content, // Dart AI uses 'text' field for markdown content
      }
    };

    const response = await dartApiRequest('/docs', 'POST', payload);
    
    // Extract doc ID and construct URL
    const docId = response.data?.duid || response.data?.id;
    
    if (!docId) {
      console.error('Dart API response:', response);
      throw new Error('Dart AI did not return a doc ID. Response may have changed.');
    }

    // Construct the doc URL
    // Based on Dart AI's URL pattern: https://app.dartai.com/doc/<docId>
    const url = `https://app.dartai.com/doc/${docId}`;

    return {
      docId,
      url,
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
 * Get a Dart AI doc by ID
 * Optional utility function for future enhancements
 */
export async function getDartDoc(docId: string): Promise<any> {
  try {
    const response = await dartApiRequest(`/docs/${docId}`, 'GET');
    
    const doc = response.data;
    if (!doc) {
      throw new Error(`Doc ${docId} not found`);
    }

    return {
      id: doc.duid || doc.id,
      title: doc.title,
      text: doc.text,
      url: `https://app.dartai.com/doc/${doc.duid || doc.id}`,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  } catch (error: any) {
    console.error('Error fetching Dart AI doc:', error);
    throw new Error(`Failed to fetch Dart AI doc: ${error.message}`);
  }
}
