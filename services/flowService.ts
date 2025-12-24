/**
 * Flow Service - Handles Google Labs Flow authentication and session management
 */

const FLOW_SESSION_KEY = 'flow_session_data';
const FLOW_LOGIN_STATUS_KEY = 'flow_login_status';

/**
 * Check if user is logged in to Google Labs Flow
 * This checks local storage for saved session status
 */
export const checkFlowLoginStatus = async (): Promise<boolean> => {
  try {
    const status = localStorage.getItem(FLOW_LOGIN_STATUS_KEY);
    if (status === 'true') {
      // Verify session is still valid by checking if we have session data
      const sessionData = localStorage.getItem(FLOW_SESSION_KEY);
      return !!sessionData;
    }
    return false;
  } catch (error) {
    console.error('[FlowService] Error checking login status:', error);
    return false;
  }
};

/**
 * Save Flow session data
 * Note: In a web app, we can't directly access cookies from labs.google domain
 * This is a placeholder that stores a flag indicating user has logged in
 */
export const saveFlowSession = async (): Promise<void> => {
  try {
    // Store login status
    localStorage.setItem(FLOW_LOGIN_STATUS_KEY, 'true');
    
    // Store timestamp
    localStorage.setItem('flow_session_timestamp', Date.now().toString());
    
    // Note: Actual cookies/session data cannot be accessed due to cross-origin restrictions
    // The FlowAutomator in Electron can access these, but web app cannot
    // This is just a flag to indicate user has completed login flow
    
    console.log('[FlowService] Flow session saved');
  } catch (error) {
    console.error('[FlowService] Error saving session:', error);
    throw error;
  }
};

/**
 * Clear Flow session data
 */
export const clearFlowSession = async (): Promise<void> => {
  try {
    localStorage.removeItem(FLOW_LOGIN_STATUS_KEY);
    localStorage.removeItem(FLOW_SESSION_KEY);
    localStorage.removeItem('flow_session_timestamp');
    
    console.log('[FlowService] Flow session cleared');
  } catch (error) {
    console.error('[FlowService] Error clearing session:', error);
    throw error;
  }
};

/**
 * Get Flow session timestamp
 */
export const getFlowSessionTimestamp = (): number | null => {
  try {
    const timestamp = localStorage.getItem('flow_session_timestamp');
    return timestamp ? parseInt(timestamp, 10) : null;
  } catch (error) {
    console.error('[FlowService] Error getting session timestamp:', error);
    return null;
  }
};

/**
 * Check if Flow session is expired (older than 7 days)
 */
export const isFlowSessionExpired = (): boolean => {
  const timestamp = getFlowSessionTimestamp();
  if (!timestamp) return true;
  
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - timestamp > sevenDays;
};

/**
 * Extract Flow authentication token from session API
 * Fetches from https://labs.google/fx/api/auth/session and extracts access_token
 * Response format: { user: {...}, expires: "...", access_token: "ya29...." }
 * @returns {Promise<string | null>} Token (access_token) or null if not found
 */
export const extractFlowToken = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    console.log('[FlowService] Starting token extraction from session API...');
    console.log('[FlowService] Fetching: https://labs.google/fx/api/auth/session');

    // Method 1: Try direct fetch with credentials (may fail due to CORS)
    fetch('https://labs.google/fx/api/auth/session', {
      method: 'GET',
      credentials: 'include', // Include cookies
      mode: 'cors',
      headers: {
        'Accept': 'application/json',
      },
    })
      .then(async (response) => {
        console.log('[FlowService] Session API response status:', response.status);
        
        if (!response.ok) {
          console.log('[FlowService] Response not OK, status:', response.status, response.statusText);
          // Try iframe method as fallback
          console.log('[FlowService] Falling back to iframe method...');
          extractTokenViaIframe(resolve);
          return;
        }

        try {
          const data = await response.json();
          console.log('[FlowService] ✅ Session API response received');
          console.log('[FlowService] Response keys:', Object.keys(data));
          
          // Extract access_token directly from response
          // Expected format: { user: {...}, expires: "...", access_token: "ya29...." }
          if (data && data.access_token && typeof data.access_token === 'string') {
            const token = data.access_token.trim();
            if (token.startsWith('ya29.')) {
              console.log('[FlowService] ✅ Access token extracted successfully!');
              console.log('[FlowService] Token preview:', token.substring(0, 30) + '...');
              console.log('[FlowService] Token length:', token.length, 'characters');
              resolve(token);
              return;
            } else {
              console.log('[FlowService] ⚠️ access_token does not start with ya29.');
              console.log('[FlowService] Token starts with:', token.substring(0, 10));
            }
          } else {
            console.log('[FlowService] ⚠️ access_token not found in response');
            console.log('[FlowService] Available keys:', Object.keys(data));
            if (data.user) {
              console.log('[FlowService] User info found:', data.user.email);
            }
          }

          // If no token found, try iframe method
          console.log('[FlowService] No access_token in direct fetch, trying iframe method...');
          extractTokenViaIframe(resolve);
        } catch (e) {
          console.log('[FlowService] Could not parse JSON response:', e);
          
          // Try as text
          try {
            const text = await response.text();
            console.log('[FlowService] Response as text (first 500 chars):', text.substring(0, 500));
            
            // Try to parse as JSON from text
            try {
              const data = JSON.parse(text);
              if (data && data.access_token) {
                console.log('[FlowService] ✅ Token found after parsing text as JSON:', data.access_token.substring(0, 30) + '...');
                resolve(data.access_token);
                return;
              }
            } catch (parseError) {
              // Not JSON, try regex
            }
            
            // Try regex to find token in text
            const token = findTokenInText(text);
            if (token) {
              console.log('[FlowService] ✅ Token found in text response:', token.substring(0, 30) + '...');
              resolve(token);
              return;
            }
          } catch (textError) {
            console.log('[FlowService] Could not read text response:', textError);
          }

          // Fallback to iframe
          console.log('[FlowService] Falling back to iframe method...');
          extractTokenViaIframe(resolve);
        }
      })
      .catch((error) => {
        console.log('[FlowService] Direct fetch failed (likely CORS), trying iframe method:', error.message);
        // Fallback to iframe method
        extractTokenViaIframe(resolve);
      });
  });
};

/**
 * Extract token using iframe (fallback method when direct fetch fails due to CORS)
 * Uses iframe to fetch session API and extract access_token
 */
const extractTokenViaIframe = (resolve: (token: string | null) => void) => {
  console.log('[FlowService] Using iframe method to extract token (fallback)...');

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = 'https://labs.google/fx/api/auth/session';
  iframe.sandbox.add('allow-same-origin', 'allow-scripts');

  let resolved = false;

  // Listen for postMessage from iframe
  const messageHandler = (event: MessageEvent) => {
    // Accept messages from labs.google or any origin (since we're using *)
    if (event.data && typeof event.data === 'object') {
      if (event.data.type === 'FLOW_TOKEN') {
        resolved = true;
        window.removeEventListener('message', messageHandler);
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        
        if (event.data.token && event.data.token.startsWith('ya29.')) {
          console.log('[FlowService] ✅ Token received via postMessage:', event.data.token.substring(0, 30) + '...');
          resolve(event.data.token);
        } else {
          console.log('[FlowService] ⚠️ No valid token in postMessage');
          resolve(null);
        }
        return;
      }
    }
  };

  window.addEventListener('message', messageHandler);

  iframe.onload = () => {
    if (resolved) return;
    
    setTimeout(() => {
      try {
        // Try to access iframe content and inject script to extract token
        const iframeWindow = iframe.contentWindow;
        const iframeDoc = iframe.contentDocument || iframeWindow?.document;
        
        if (iframeDoc && iframeWindow) {
          // Inject script to fetch session API and send token via postMessage
          const script = iframeDoc.createElement('script');
          script.textContent = `
            (function() {
              console.log('[Iframe] Fetching session API...');
              fetch('/fx/api/auth/session', {
                method: 'GET',
                credentials: 'include',
                headers: { 
                  'Accept': 'application/json'
                }
              })
              .then(response => {
                console.log('[Iframe] Response status:', response.status);
                return response.json();
              })
              .then(data => {
                console.log('[Iframe] Response data keys:', Object.keys(data));
                if (data && data.access_token && typeof data.access_token === 'string') {
                  console.log('[Iframe] ✅ Found access_token');
                  window.parent.postMessage({
                    type: 'FLOW_TOKEN',
                    token: data.access_token
                  }, '*');
                } else {
                  console.log('[Iframe] ⚠️ No access_token in response');
                  window.parent.postMessage({
                    type: 'FLOW_TOKEN',
                    token: null
                  }, '*');
                }
              })
              .catch(error => {
                console.log('[Iframe] Fetch error:', error.message);
                window.parent.postMessage({
                  type: 'FLOW_TOKEN',
                  token: null
                }, '*');
              });
            })();
          `;
          
          // Wait for iframe body to be ready
          if (iframeDoc.body) {
            iframeDoc.body.appendChild(script);
          } else {
            iframeDoc.addEventListener('DOMContentLoaded', () => {
              if (iframeDoc.body) {
                iframeDoc.body.appendChild(script);
              }
            });
          }
        } else {
          // Cannot access iframe (cross-origin) - try alternative
          console.log('[FlowService] Cannot access iframe content (cross-origin)');
          if (!resolved) {
            resolved = true;
            window.removeEventListener('message', messageHandler);
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
            console.log('[FlowService] ⚠️ Iframe method failed due to cross-origin restrictions');
            resolve(null);
          }
        }
      } catch (e) {
        // Cross-origin error
        console.log('[FlowService] Cross-origin error accessing iframe:', e);
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', messageHandler);
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
          resolve(null);
        }
      }
    }, 2000); // Wait 2 seconds for iframe to load
  };

  iframe.onerror = () => {
    if (!resolved) {
      resolved = true;
      window.removeEventListener('message', messageHandler);
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
      console.log('[FlowService] Iframe load error');
      resolve(null);
    }
  };

  document.body.appendChild(iframe);

  // Timeout after 15 seconds
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      window.removeEventListener('message', messageHandler);
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
      console.log('[FlowService] Token extraction timeout (15s)');
      resolve(null);
    }
  }, 15000);
};

/**
 * Find token in data object (recursive search)
 */
const findTokenInData = (data: any): string | null => {
  if (!data || typeof data !== 'object') return null;

  // Check if data itself is a token
  if (typeof data === 'string' && data.startsWith('ya29.')) {
    return data;
  }

  // Recursively search in object
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      const value = data[key];
      
      if (typeof value === 'string' && value.startsWith('ya29.')) {
        return value;
      }
      
      if (typeof value === 'object') {
        const found = findTokenInData(value);
        if (found) return found;
      }
    }
  }

  return null;
};

/**
 * Extract token from cookie string
 */
const extractTokenFromCookie = (cookieString: string): string | null => {
  const cookies = cookieString.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (value && value.startsWith('ya29.')) {
      return value;
    }
  }
  return null;
};

/**
 * Extract token from cookies in current domain
 */
const extractTokenFromCookies = (): string | null => {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (value && value.startsWith('ya29.')) {
      return value;
    }
  }
  return null;
};

/**
 * Find token in iframe document
 */
const findTokenInIframe = (iframeDoc: Document): string | null => {
  try {
    // Check localStorage
    const localStorage = iframeDoc.defaultView?.localStorage;
    if (localStorage) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value && value.startsWith('ya29.')) {
            return value;
          }
        }
      }
    }

    // Check cookies
    const cookies = iframeDoc.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (value && value.startsWith('ya29.')) {
        return value;
      }
    }

    // Check body text
    const bodyText = iframeDoc.body?.innerText || '';
    return findTokenInText(bodyText);
  } catch (e) {
    return null;
  }
};

/**
 * Find token in text content
 */
const findTokenInText = (text: string): string | null => {
  // Look for token pattern: ya29. followed by alphanumeric characters
  const tokenPattern = /ya29\.[A-Za-z0-9_-]+/g;
  const matches = text.match(tokenPattern);
  if (matches && matches.length > 0) {
    return matches[0];
  }
  return null;
};

