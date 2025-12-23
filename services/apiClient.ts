
import { addLogEntry } from './aiLogService';
import { type User } from '../types';
import { supabase } from './supabaseClient';
import { PROXY_SERVER_URLS } from './serverConfig';

export const getVeoProxyUrl = (): string => {
  // CRITICAL: Always use localhost when running on localhost - ignore sessionStorage
  const hostname = window.location.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
  
  // Additional check: if port is 8080 (Vite dev server), assume localhost
  const isDevPort = window.location.port === '8080' || window.location.port === '3000';
  
  if (isLocalhost || isDevPort) {
    console.log(`[API Client] Running on localhost (hostname: ${hostname}, port: ${window.location.port}) - forcing localhost:3001 for Veo`);
    return 'http://localhost:3001';
  }
  const userSelectedProxy = sessionStorage.getItem('selectedProxyServer');
  if (userSelectedProxy) {
      return userSelectedProxy;
  }
  // Default if nothing selected - Use a known active server (s1)
  return 'https://s1.monoklix.com';
};

export const getImagenProxyUrl = (): string => {
  // CRITICAL: Always use localhost when running on localhost - ignore sessionStorage
  const hostname = window.location.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
  
  // Additional check: if port is 8080 (Vite dev server), assume localhost
  const isDevPort = window.location.port === '8080' || window.location.port === '3000';
  
  if (isLocalhost || isDevPort) {
    console.log(`[API Client] Running on localhost (hostname: ${hostname}, port: ${window.location.port}) - forcing localhost:3001 for Imagen`);
    return 'http://localhost:3001';
  }
  const userSelectedProxy = sessionStorage.getItem('selectedProxyServer');
  if (userSelectedProxy) {
      return userSelectedProxy;
  }
  return 'https://s1.monoklix.com';
};

const getPersonalTokenLocal = (): { token: string; createdAt: string; } | null => {
    try {
        const userJson = localStorage.getItem('currentUser');
        if (userJson) {
            const user = JSON.parse(userJson);
            if (user && user.personalAuthToken && typeof user.personalAuthToken === 'string' && user.personalAuthToken.trim().length > 0) {
                return { token: user.personalAuthToken, createdAt: 'personal' };
            }
        }
    } catch (e) {
        console.error("Could not parse user from localStorage to get personal token", e);
    }
    return null;
};

// Fallback: Fetch fresh token from DB if missing locally
const getFreshPersonalTokenFromDB = async (): Promise<string | null> => {
    try {
        const userJson = localStorage.getItem('currentUser');
        if (!userJson) {
            console.warn('[API Client] No currentUser in localStorage');
            return null;
        }
        
        const user = JSON.parse(userJson);
        if (!user || !user.id) {
            console.warn('[API Client] User object invalid or missing ID');
            return null;
        }

        console.log(`[API Client] Fetching token for user ${user.id} from DB...`);
        const { data, error } = await supabase
            .from('users')
            .select('personal_auth_token')
            .eq('id', user.id)
            .single();
            
        if (error) {
            console.error('[API Client] Supabase error fetching token:', error);
            return null;
        }

        if (data && data.personal_auth_token) {
            // Update local storage to prevent future fetches
            const updatedUser = { ...user, personalAuthToken: data.personal_auth_token };
            localStorage.setItem('currentUser', JSON.stringify(updatedUser));
            console.log('[API Client] Refreshed personal token from DB and updated localStorage.');
            return data.personal_auth_token;
        } else {
            console.warn('[API Client] DB query returned no token (null/empty).');
        }
    } catch (e) {
        console.error("[API Client] Exception refreshing token from DB", e);
    }
    return null;
};

const getCurrentUserInternal = (): User | null => {
    try {
        const savedUserJson = localStorage.getItem('currentUser');
        if (savedUserJson) {
            const user = JSON.parse(savedUserJson) as User;
            if (user && user.id) {
                return user;
            }
        }
    } catch (error) {
        console.error("Failed to parse user from localStorage for activity log.", error);
    }
    return null;
};

// --- EXECUTE REQUEST (STRICT PERSONAL TOKEN ONLY) ---

export const executeProxiedRequest = async (
  relativePath: string,
  serviceType: 'veo' | 'imagen',
  requestBody: any,
  logContext: string,
  specificToken?: string,
  onStatusUpdate?: (status: string) => void,
  overrideServerUrl?: string // New parameter to force a specific server
): Promise<{ data: any; successfulToken: string; successfulServerUrl: string }> => {
  const isStatusCheck = logContext === 'VEO STATUS';
  
  if (!isStatusCheck) {
      console.log(`[API Client] Starting process for: ${logContext}`);
  }
  
  // Use override URL if provided, otherwise default to standard proxy selection
  const selectedUrl = serviceType === 'veo' ? getVeoProxyUrl() : getImagenProxyUrl();
  let currentServerUrl = overrideServerUrl || selectedUrl;
  
  // CRITICAL: Force localhost if we're in localhost environment but URL is not localhost
  const hostname = window.location.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
  const isDevPort = window.location.port === '8080' || window.location.port === '3000';
  const isLocalEnv = isLocalhost || isDevPort;
  
  if (isLocalEnv && !currentServerUrl.includes('localhost:3001')) {
    console.warn(`[API Client] ⚠️ WARNING: Running on localhost (${hostname}:${window.location.port}) but selected URL is ${currentServerUrl}. Forcing localhost:3001.`);
    currentServerUrl = 'http://localhost:3001';
  }
  
  // Debug logging for localhost detection
  if (!isStatusCheck) {
    console.log(`[API Client] Hostname: ${window.location.hostname}, Port: ${window.location.port}, IsLocalEnv: ${isLocalEnv}, Selected URL: ${currentServerUrl}`);
  }
  
  // 1. Acquire Server Slot (Rate Limiting at Server Level)
  const isGenerationRequest = logContext.includes('GENERATE') || logContext.includes('RECIPE');
  
  if (isGenerationRequest) {
    if (onStatusUpdate) onStatusUpdate('Queueing...');
    try {
        await supabase.rpc('request_generation_slot', { cooldown_seconds: 10, server_url: currentServerUrl });
    } catch (slotError) {
        console.warn('Slot request failed, proceeding anyway:', slotError);
    }
    if (onStatusUpdate) onStatusUpdate('Processing...');
  }
  
  // 2. Resolve Token
  let finalToken = specificToken;
  let sourceLabel: 'Specific' | 'Personal' = 'Specific';

  if (!finalToken) {
      // Step A: Check Local Storage
      const personalLocal = getPersonalTokenLocal();
      if (personalLocal) {
          finalToken = personalLocal.token;
          sourceLabel = 'Personal';
      } 
      
      // Step B: If local missing, check Database
      if (!finalToken) {
          const freshToken = await getFreshPersonalTokenFromDB();
          if (freshToken) {
              finalToken = freshToken;
              sourceLabel = 'Personal';
          }
      }
  }

  if (!finalToken) {
      console.error(`[API Client] Authentication failed. No token found in LocalStorage or DB.`);
      throw new Error(`Authentication failed: No Personal Token found. Please go to Settings > Token & API and set your token.`);
  }

  // 3. Log
  if (!isStatusCheck && sourceLabel === 'Personal') {
      // console.log(`[API Client] Using Personal Token: ...${finalToken.slice(-6)}`);
  }

  const currentUser = getCurrentUserInternal();
  
  // 4. Execute
  try {
      const endpoint = `${currentServerUrl}/api/${serviceType}${relativePath}`;
      
      if (!isStatusCheck) {
          console.log(`[API Client] Making request to: ${endpoint}`);
          console.log(`[API Client] Server URL: ${currentServerUrl}, Service: ${serviceType}, Path: ${relativePath}`);
      }
      
      const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${finalToken}`,
              'x-user-username': currentUser?.username || 'unknown',
          },
          body: JSON.stringify(requestBody),
      });

      let data;
      const textResponse = await response.text();
      try {
          data = JSON.parse(textResponse);
      } catch {
          data = { error: { message: `Proxy returned non-JSON (${response.status}): ${textResponse.substring(0, 100)}` } };
      }

      if (!response.ok) {
          const status = response.status;
          let errorMessage = data.error?.message || data.message || `API call failed (${status})`;
          const lowerMsg = errorMessage.toLowerCase();

          // Check for hard errors
          if (status === 400 || lowerMsg.includes('safety') || lowerMsg.includes('blocked')) {
              console.warn(`[API Client] 🛑 Non-retriable error (${status}). Prompt issue.`);
              throw new Error(`[${status}] ${errorMessage}`);
          }
          
          throw new Error(errorMessage);
      }

      if (!isStatusCheck) {
          console.log(`✅ [API Client] Success using ${sourceLabel} token on ${currentServerUrl}`);
      }
      return { data, successfulToken: finalToken, successfulServerUrl: currentServerUrl };

  } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      
      // Better error handling for network errors (like failed to fetch)
      if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('fetch') || errMsg.includes('ERR_')) {
          const hostname = window.location.hostname.toLowerCase();
          const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
          const isDevPort = window.location.port === '8080' || window.location.port === '3000';
          const isLocalEnv = isLocalhost || isDevPort;
          
          let networkError = `Network error: Cannot connect to ${currentServerUrl}`;
          
          if (isLocalEnv && currentServerUrl.includes('localhost:3001')) {
              networkError += `. Make sure the server is running. Start it with: cd server && npm start`;
          } else if (isLocalEnv && !currentServerUrl.includes('localhost:3001')) {
              networkError += `. ERROR: Running on localhost but trying to connect to ${currentServerUrl}. Should be using localhost:3001.`;
          } else {
              networkError += `. Please check if the server is accessible.`;
          }
          
          console.error(`[API Client] ❌ ${networkError}`);
          console.error(`[API Client] Endpoint attempted: ${currentServerUrl}/api/${serviceType}${relativePath}`);
          throw new Error(networkError);
      }
      
      const isSafetyError = errMsg.includes('[400]') || errMsg.toLowerCase().includes('safety') || errMsg.toLowerCase().includes('blocked');

      if (!specificToken && !isSafetyError && !isStatusCheck) {
          addLogEntry({ 
              model: logContext, 
              prompt: `Failed using ${sourceLabel} token`, 
              output: errMsg, 
              tokenCount: 0, 
              status: 'Error', 
              error: errMsg 
          });
      }
      throw error;
  }
};
