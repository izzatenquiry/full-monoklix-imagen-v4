
import { addLogEntry } from './aiLogService';
import { type User } from '../types';
import { supabase } from './supabaseClient';
import { PROXY_SERVER_URLS } from './serverConfig';
import { getAvailableServersForUser } from './userService';
import { getAllTokens as getTokenPoolTokens } from './tokenPoolService';

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
// First tries to get personal token from users table, then falls back to latest token from token_new_active table
const getFreshPersonalTokenFromDB = async (retryCount: number = 0): Promise<string | null> => {
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

        console.log(`[API Client] Fetching personal token for user ${user.id} from users table... (attempt ${retryCount + 1})`);
        // First, try to get personal token from users table
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id, personal_auth_token, updated_at')
            .eq('id', user.id)
            .maybeSingle();
            
        if (userError) {
            console.error('[API Client] Supabase error fetching user token:', userError);
        }

        if (userData && userData.personal_auth_token && typeof userData.personal_auth_token === 'string' && userData.personal_auth_token.trim().length > 0) {
            // Update local storage to prevent future fetches
            const updatedUser = { ...user, personalAuthToken: userData.personal_auth_token };
            localStorage.setItem('currentUser', JSON.stringify(updatedUser));
            console.log('[API Client] ✅ Found personal token from users table and updated localStorage.');
            return userData.personal_auth_token;
        }

        // If no personal token, fetch latest token from token_new_active table
        console.log(`[API Client] No personal token found, fetching latest token from token_new_active table...`);
        const { data: tokenData, error: tokenError } = await supabase
            .from('token_new_active')
            .select('token')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
            
        if (tokenError) {
            console.error('[API Client] Supabase error fetching token from token_new_active:', tokenError);
            console.error('[API Client] Error details:', JSON.stringify(tokenError, null, 2));
            // Retry on error if we haven't retried yet
            if (retryCount < 2) {
                console.log(`[API Client] Retrying token fetch in 1 second... (attempt ${retryCount + 2})`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return getFreshPersonalTokenFromDB(retryCount + 1);
            }
            return null;
        }

        console.log('[API Client] DB query response from token_new_active:', { 
            hasData: !!tokenData, 
            hasToken: !!(tokenData?.token),
            tokenLength: tokenData?.token?.length || 0,
            tokenPreview: tokenData?.token ? `${tokenData.token.substring(0, 10)}...` : 'null'
        });

        if (tokenData && tokenData.token && typeof tokenData.token === 'string' && tokenData.token.trim().length > 0) {
            console.log('[API Client] ✅ Found latest token from token_new_active table.');
            return tokenData.token;
        } else {
            // If no token found, retry once more after a short delay (in case of replication delay)
            if (retryCount < 1) {
                console.log(`[API Client] No token found, retrying in 1.5 seconds... (attempt ${retryCount + 2})`);
                await new Promise(resolve => setTimeout(resolve, 1500));
                return getFreshPersonalTokenFromDB(retryCount + 1);
            }
            console.warn('[API Client] ⚠️ DB query returned no token (null/empty) after retries. Data:', tokenData);
        }
    } catch (e) {
        console.error("[API Client] Exception refreshing token from DB", e);
        // Retry on exception if we haven't retried yet
        if (retryCount < 2) {
            console.log(`[API Client] Exception occurred, retrying in 1 second... (attempt ${retryCount + 2})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return getFreshPersonalTokenFromDB(retryCount + 1);
        }
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
  const isGenerationRequest = logContext.includes('GENERATE') || logContext.includes('RECIPE');
  
  if (!isStatusCheck) {
      console.log(`[API Client] Starting process for: ${logContext}`);
  }
  
  // 2. Resolve Tokens and Servers for Hybrid Retry System
  const currentUser = getCurrentUserInternal();
  
  // Get all available tokens (personal + pool)
  const availableTokens: Array<{ token: string; source: 'Specific' | 'Personal' | 'RandomPool' }> = [];
  
  if (specificToken) {
      availableTokens.push({ token: specificToken, source: 'Specific' });
  } else {
      // For imagen: Use personal token first, then fallback to pool tokens from session
      // For veo: Use personal token if available, then fallback to token_new_active
      if (serviceType === 'imagen') {
          // Step 1: Try personal token first
          const personalLocal = getPersonalTokenLocal();
          if (personalLocal) {
              availableTokens.push({ token: personalLocal.token, source: 'Personal' });
          } else {
              const freshToken = await getFreshPersonalTokenFromDB();
              if (freshToken) {
                  availableTokens.push({ token: freshToken, source: 'Personal' });
              }
          }
          
          // Step 2: Add pool tokens from session (fetched during login)
          const poolTokens = getTokenPoolTokens();
          poolTokens.forEach(token => {
              // Avoid duplicates
              if (!availableTokens.find(t => t.token === token)) {
                  availableTokens.push({ token, source: 'RandomPool' });
              }
          });
      } else {
          // For veo: Use personal token if available
          const personalLocal = getPersonalTokenLocal();
          if (personalLocal) {
              availableTokens.push({ token: personalLocal.token, source: 'Personal' });
          } else {
              const freshToken = await getFreshPersonalTokenFromDB();
              if (freshToken) {
                  availableTokens.push({ token: freshToken, source: 'Personal' });
              }
          }
      }
  }

  if (availableTokens.length === 0) {
      if (serviceType === 'imagen') {
          console.error(`[API Client] Authentication failed. No token found in LocalStorage, DB, or token pool.`);
          throw new Error(`Authentication failed: No token available. Please login to Flow or set your personal token in Settings > Token & API.`);
      } else {
          console.error(`[API Client] Authentication failed. No token found in LocalStorage or DB.`);
          throw new Error(`Authentication failed: No Personal Token found. Please go to Settings > Token & API and set your token.`);
      }
  }

  // Get all available servers
  let availableServers: string[] = [];
  if (overrideServerUrl) {
      availableServers = [overrideServerUrl];
  } else {
      if (currentUser) {
          availableServers = await getAvailableServersForUser(currentUser);
      } else {
          availableServers = PROXY_SERVER_URLS;
      }
      
      // Filter by device if needed
      const { getDeviceOS } = await import('./userService');
      const { getServersForDevice } = await import('./serverConfig');
      const deviceType = getDeviceOS();
      const deviceServers = getServersForDevice(deviceType, availableServers);
      if (deviceServers.length > 0) {
          availableServers = deviceServers;
      }
      
      // If user has selected server, prioritize it
      const userSelectedServer = sessionStorage.getItem('selectedProxyServer');
      if (userSelectedServer && availableServers.includes(userSelectedServer)) {
          availableServers = [userSelectedServer, ...availableServers.filter(s => s !== userSelectedServer)];
      }
  }

  // Handle localhost
  const hostname = window.location.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
  const isDevPort = window.location.port === '8080' || window.location.port === '3000';
  const isLocalEnv = isLocalhost || isDevPort;
  
  if (isLocalEnv) {
      availableServers = ['http://localhost:3001'];
  }

  // 3. Hybrid Retry System - Try different server/token combinations
  const maxRetries = isGenerationRequest ? Math.min(availableServers.length * availableTokens.length, 10) : 1; // Max 10 combinations for generation
  
  let lastError: Error | null = null;
  let triedCombinations = 0;
  let slotRequested = false;
  
  // Shuffle servers and tokens for better distribution
  const shuffledServers = [...availableServers].sort(() => Math.random() - 0.5);
  const shuffledTokens = [...availableTokens].sort(() => Math.random() - 0.5);
  
  for (let serverIdx = 0; serverIdx < shuffledServers.length && triedCombinations < maxRetries; serverIdx++) {
      const serverUrl = shuffledServers[serverIdx];
      
      for (let tokenIdx = 0; tokenIdx < shuffledTokens.length && triedCombinations < maxRetries; tokenIdx++) {
          const tokenInfo = shuffledTokens[tokenIdx];
          triedCombinations++;
          
          try {
              if (!isStatusCheck && triedCombinations > 1) {
                  console.log(`[API Client] Retry attempt ${triedCombinations}/${maxRetries}: Trying ${tokenInfo.source} token on ${serverUrl}`);
                  if (onStatusUpdate) {
                      onStatusUpdate(`Retrying with different server/token (${triedCombinations}/${maxRetries})...`);
                  }
              }
              
              // Acquire server slot for generation requests (only once for first server)
              if (isGenerationRequest && !slotRequested && triedCombinations === 1) {
                  if (onStatusUpdate) onStatusUpdate('Queueing...');
                  try {
                      await supabase.rpc('request_generation_slot', { cooldown_seconds: 10, server_url: serverUrl });
                      slotRequested = true;
                  } catch (slotError) {
                      console.warn('Slot request failed, proceeding anyway:', slotError);
                  }
                  if (onStatusUpdate) onStatusUpdate('Processing...');
              }
              
              const endpoint = `${serverUrl}/api/${serviceType}${relativePath}`;
              
              if (!isStatusCheck && triedCombinations === 1) {
                  console.log(`[API Client] Making request to: ${endpoint}`);
                  console.log(`[API Client] Server URL: ${serverUrl}, Service: ${serviceType}, Path: ${relativePath}`);
                  console.log(`[API Client] Using ${tokenInfo.source} token`);
              }
              
              const response = await fetch(endpoint, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${tokenInfo.token}`,
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

                  // Check for hard errors - don't retry these
                  if (status === 400 || lowerMsg.includes('safety') || lowerMsg.includes('blocked') || lowerMsg.includes('invalid prompt')) {
                      console.warn(`[API Client] 🛑 Non-retriable error (${status}). Prompt issue: ${errorMessage}`);
                      throw new Error(`[${status}] ${errorMessage}`);
                  }
                  
                  // For other errors, continue to next combination
                  lastError = new Error(errorMessage);
                  console.warn(`[API Client] ⚠️ Attempt ${triedCombinations} failed: ${errorMessage} (${serverUrl} + ${tokenInfo.source} token)`);
                  continue; // Try next combination
              }

              // Success!
              if (!isStatusCheck) {
                  console.log(`✅ [API Client] Success using ${tokenInfo.source} token on ${serverUrl} (attempt ${triedCombinations})`);
              }
              return { data, successfulToken: tokenInfo.token, successfulServerUrl: serverUrl };
              
          } catch (error) {
              const errMsg = error instanceof Error ? error.message : String(error);
              
              // Check if it's a hard error (don't retry)
              const isHardError = errMsg.includes('[400]') || errMsg.toLowerCase().includes('safety') || errMsg.toLowerCase().includes('blocked') || errMsg.toLowerCase().includes('invalid prompt');
              
              if (isHardError) {
                  // Don't retry hard errors
                  if (!isStatusCheck) {
                      addLogEntry({ 
                          model: logContext, 
                          prompt: `Failed using ${tokenInfo.source} token`, 
                          output: errMsg, 
                          tokenCount: 0, 
                          status: 'Error', 
                          error: errMsg 
                      });
                  }
                  throw error; // Re-throw hard errors immediately
              }
              
              // Network errors - continue to next combination
              if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('fetch') || errMsg.includes('ERR_')) {
                  lastError = new Error(`Network error: Cannot connect to ${serverUrl}`);
                  console.warn(`[API Client] ⚠️ Network error on ${serverUrl}, trying next server/token combination...`);
                  continue;
              }
              
              // Other errors - continue to next combination
              lastError = error instanceof Error ? error : new Error(String(error));
              console.warn(`[API Client] ⚠️ Attempt ${triedCombinations} failed: ${errMsg}`);
              
              // If we've tried all combinations, throw the last error
              if (triedCombinations >= maxRetries) {
                  break;
              }
          }
      }
  }
  
  // All combinations failed
  if (lastError) {
      const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
      
      if (!isStatusCheck) {
          addLogEntry({ 
              model: logContext, 
              prompt: `Failed after ${triedCombinations} attempts with different server/token combinations`, 
              output: errMsg, 
              tokenCount: 0, 
              status: 'Error', 
              error: errMsg 
          });
      }
      
      console.error(`[API Client] ❌ All ${triedCombinations} server/token combinations failed. Last error: ${errMsg}`);
      throw new Error(`Generation failed after trying ${triedCombinations} different server/token combinations. Last error: ${errMsg}`);
  }
  
  // Should never reach here, but just in case
  throw new Error('Generation failed: No server/token combination available');
};
