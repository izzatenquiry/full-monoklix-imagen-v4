import React, { useState, useEffect, useRef } from 'react';
import { CheckCircleIcon, XIcon, ExternalLinkIcon, RefreshCwIcon, ClipboardIcon } from './Icons';
import Spinner from './common/Spinner';
import { checkFlowLoginStatus, saveFlowSession, clearFlowSession, extractFlowToken } from '../services/flowService';
import { saveUserPersonalAuthToken } from '../services/userService';
import { fetchTokenPool } from '../services/tokenPoolService';
import { type User } from '../types';

interface FlowLoginProps {
  language?: 'en' | 'ms';
  currentUser?: User | null;
  onUserUpdate?: (user: User) => void;
  onTokenExtracted?: (token: string) => void; // Callback to update personal token field
}

const FlowLogin: React.FC<FlowLoginProps> = ({ language = 'en', currentUser, onUserUpdate, onTokenExtracted }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showConfirmButton, setShowConfirmButton] = useState(false);
  const [isExtractingToken, setIsExtractingToken] = useState(false);
  const [extractedToken, setExtractedToken] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const tokenPopupRef = useRef<Window | null>(null);
  const checkIntervalRef = useRef<number | null>(null);

  const translations = {
    en: {
      title: 'Google Labs Flow Login',
      description: 'Connect your Google account to use Flow automation features.',
      status: {
        checking: 'Checking login status...',
        loggedIn: 'Logged in to Google Labs Flow',
        notLoggedIn: 'Not logged in',
      },
      loginButton: 'Login to Flow',
      logoutButton: 'Logout',
      loginInProgress: 'Please complete login in the popup window...',
      loginSuccess: 'Successfully logged in!',
      loginError: 'Login failed. Please try again.',
      logoutSuccess: 'Logged out successfully',
    },
    ms: {
      title: 'Log Masuk Google Labs Flow',
      description: 'Sambungkan akaun Google anda untuk menggunakan ciri automasi Flow.',
      status: {
        checking: 'Menyemak status log masuk...',
        loggedIn: 'Telah log masuk ke Google Labs Flow',
        notLoggedIn: 'Belum log masuk',
      },
      loginButton: 'Log Masuk ke Flow',
      logoutButton: 'Log Keluar',
      loginInProgress: 'Sila lengkapkan log masuk di tetingkap popup...',
      loginSuccess: 'Berjaya log masuk!',
      loginError: 'Log masuk gagal. Sila cuba lagi.',
      logoutSuccess: 'Berjaya log keluar',
    },
  };

  const T = translations[language];

  // Check login status on mount
  useEffect(() => {
    checkLoginStatus();
    
    // Listen for postMessage from token popup
    const messageHandler = (event: MessageEvent) => {
      // Accept messages from any origin (data URL or labs.google)
      if (event.data && typeof event.data === 'object') {
        if (event.data.type === 'FLOW_TOKEN_EXTRACTED') {
          if (event.data.token && event.data.token.startsWith('ya29.')) {
            console.log('[FlowLogin] ✅ Token received via postMessage:', event.data.token.substring(0, 30) + '...');
            handleTokenExtracted(event.data.token);
          } else if (event.data.error) {
            console.error('[FlowLogin] Token extraction error:', event.data.error);
            setIsExtractingToken(false);
            setLoginError(event.data.error || 'Failed to extract token. Please make sure you are logged in to Google Labs Flow.');
          } else {
            console.log('[FlowLogin] ⚠️ No token in postMessage');
            setIsExtractingToken(false);
            setLoginError('Token not found. Please make sure you are logged in to Google Labs Flow.');
          }
        }
      }
    };
    
    window.addEventListener('message', messageHandler);
    
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
      if (tokenPopupRef.current && !tokenPopupRef.current.closed) {
        tokenPopupRef.current.close();
      }
      window.removeEventListener('message', messageHandler);
    };
  }, [currentUser, onUserUpdate, onTokenExtracted]);

  const checkLoginStatus = async () => {
    setIsChecking(true);
    try {
      const status = await checkFlowLoginStatus();
      setIsLoggedIn(status);
      setLoginError(null);
    } catch (error) {
      console.error('[FlowLogin] Error checking status:', error);
      setIsLoggedIn(false);
    } finally {
      setIsChecking(false);
    }
  };

  const handleLogin = () => {
    setLoginError(null);
    setIsLoggingIn(true);
    
    // Open Flow in popup window (Google blocks iframe for security)
    const width = 900;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const popup = window.open(
      'https://labs.google/fx/tools/flow/',
      'flowLogin',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no`
    );

    if (!popup) {
      setLoginError('Popup blocked. Please allow popups for this site and try again.');
      setIsLoggingIn(false);
      return;
    }

    popupRef.current = popup;

    // Monitor popup for completion
    const checkPopup = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkPopup);
        setIsLoggingIn(false);
        // When popup closes, show confirm button
        setShowConfirmButton(true);
        return;
      }

      // Try to detect if user navigated to project page (logged in)
      try {
        const popupUrl = popup.location.href;
        if (popupUrl.includes('labs.google') && 
            popupUrl.includes('tools/flow') && 
            !popupUrl.includes('accounts.google.com') &&
            !popupUrl.includes('signin')) {
          // User seems to be logged in - wait a bit then close and save
          setTimeout(() => {
            clearInterval(checkPopup);
            popup.close();
            setIsLoggingIn(false);
            handleLoginSuccess();
          }, 2000);
        }
      } catch (e) {
        // Cross-origin error is expected, continue monitoring
      }
    }, 1000);

    // Timeout after 10 minutes
    setTimeout(() => {
      if (!popup.closed) {
        clearInterval(checkPopup);
        setIsLoggingIn(false);
      }
    }, 600000);
  };

  const handleLoginSuccess = async () => {
    try {
      setIsChecking(true);
      await saveFlowSession();
      
      // Wait a bit then check status
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force check status after saving
      const status = await checkFlowLoginStatus();
      setIsLoggedIn(status);
      setIsChecking(false);
      
      if (status) {
        // Show success notification
        const successMsg = document.createElement('div');
        successMsg.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-zoomIn';
        successMsg.textContent = T.loginSuccess;
        document.body.appendChild(successMsg);
        setTimeout(() => {
          if (document.body.contains(successMsg)) {
            document.body.removeChild(successMsg);
          }
        }, 3000);
      } else {
        setLoginError('Session saved but status check failed. Please click Refresh Status.');
      }
    } catch (error) {
      console.error('[FlowLogin] Error saving session:', error);
      setLoginError(T.loginError);
      setIsChecking(false);
    }
  };

  const handleConfirmLogin = async () => {
    // User manually confirms they've logged in
    setIsLoggingIn(false);
    setShowConfirmButton(false);
    setIsExtractingToken(true);
    setExtractedToken(null);
    setLoginError(null);

    console.log('[FlowLogin] Starting automatic token extraction...');

    // Method 1: Try direct fetch first (background, no popup needed)
    // Retry up to 3 times with delays
    let token: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[FlowLogin] Attempting direct fetch (background) - attempt ${attempt}/3...`);
        token = await extractFlowToken();
        
        if (token && token.startsWith('ya29.')) {
          console.log(`[FlowLogin] ✅ Token extracted via direct fetch (background) - attempt ${attempt}`);
          await handleTokenExtracted(token);
          return;
        }
        
        // If no token but no error, wait a bit and retry
        if (attempt < 3) {
          console.log(`[FlowLogin] No token found, retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.log(`[FlowLogin] Direct fetch attempt ${attempt} failed:`, error);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    if (token && token.startsWith('ya29.')) {
      await handleTokenExtracted(token);
      return;
    }
    
    console.log('[FlowLogin] Direct fetch failed after 3 attempts, trying iframe method...');

    // Method 2: If direct fetch fails, try hidden iframe method (background)
    console.log('[FlowLogin] Trying hidden iframe method (background)...');
    
    try {
      // Create hidden iframe that will extract token
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.src = 'https://labs.google/fx/api/auth/session';
      
      let resolved = false;
      
      // Listen for postMessage from iframe
      const messageHandler = (event: MessageEvent) => {
        if (resolved) return;
        
        if (event.data && typeof event.data === 'object' && event.data.type === 'FLOW_TOKEN') {
          resolved = true;
          window.removeEventListener('message', messageHandler);
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
          
          if (event.data.token && event.data.token.startsWith('ya29.')) {
            console.log('[FlowLogin] ✅ Token extracted via iframe');
            handleTokenExtracted(event.data.token);
          } else {
            // Iframe method failed, try popup as last resort
            openPopupForExtraction();
          }
        }
      };
      
      window.addEventListener('message', messageHandler);
      
      // Inject script into iframe after load
      iframe.onload = () => {
        setTimeout(() => {
          try {
            const iframeWindow = iframe.contentWindow;
            const iframeDoc = iframe.contentDocument || iframeWindow?.document;
            
            if (iframeDoc && iframeWindow) {
              const script = iframeDoc.createElement('script');
              script.textContent = `
                fetch('/fx/api/auth/session', {
                  credentials: 'include',
                  headers: { 'Accept': 'application/json' }
                })
                .then(r => r.json())
                .then(d => {
                  if (d && d.access_token && d.access_token.startsWith('ya29.')) {
                    window.parent.postMessage({
                      type: 'FLOW_TOKEN',
                      token: d.access_token
                    }, '*');
                  } else {
                    window.parent.postMessage({
                      type: 'FLOW_TOKEN',
                      token: null
                    }, '*');
                  }
                })
                .catch(e => {
                  window.parent.postMessage({
                    type: 'FLOW_TOKEN',
                    token: null
                  }, '*');
                });
              `;
              
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
              // Cross-origin - iframe method won't work
              if (!resolved) {
                resolved = true;
                window.removeEventListener('message', messageHandler);
                if (document.body.contains(iframe)) {
                  document.body.removeChild(iframe);
                }
                openPopupForExtraction();
              }
            }
          } catch (e) {
            // Cross-origin error
            if (!resolved) {
              resolved = true;
              window.removeEventListener('message', messageHandler);
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
              }
              openPopupForExtraction();
            }
          }
        }, 2000);
      };
      
      iframe.onerror = () => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', messageHandler);
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
          openPopupForExtraction();
        }
      };
      
      document.body.appendChild(iframe);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', messageHandler);
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
          openPopupForExtraction();
        }
      }, 10000);
      
    } catch (error) {
      console.log('[FlowLogin] Iframe method failed, trying popup...', error);
      openPopupForExtraction();
    }
  };

  const openPopupForExtraction = () => {
    // Last resort: Show error message
    // Direct fetch and iframe methods have both failed
    console.log('[FlowLogin] All automatic extraction methods failed');
    setIsExtractingToken(false);
    setLoginError('Automatic token extraction failed. This may be due to browser security restrictions. Please ensure you are logged in to Google Labs Flow in this browser, then try refreshing the page and attempting again. If the issue persists, you may need to manually copy the access_token from https://labs.google/fx/api/auth/session and paste it in the Personal Auth Token field above.');
  };

  const handleTokenExtracted = async (token: string) => {
    console.log('[FlowLogin] Handling extracted token...');
    setExtractedToken(token);
    setIsExtractingToken(false);
    
    // Save session and update status
    await saveFlowSession();
    await checkLoginStatus();
    
    // Show success notification
    const successMsg = document.createElement('div');
    successMsg.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-zoomIn';
    successMsg.textContent = T.loginSuccess;
    document.body.appendChild(successMsg);
    setTimeout(() => {
      if (document.body.contains(successMsg)) {
        document.body.removeChild(successMsg);
      }
    }, 3000);
    
    // Close popup if open
    if (tokenPopupRef.current && !tokenPopupRef.current.closed) {
      tokenPopupRef.current.close();
    }
  };

  const handleSaveToken = async (token: string) => {
    if (!currentUser || !onUserUpdate) {
      setLoginError('User context required to save token');
      return;
    }

    try {
      setIsExtractingToken(true);
      console.log('[FlowLogin] Saving token to user profile...');
      const result = await saveUserPersonalAuthToken(currentUser.id, token);
      
      if (result.success) {
        console.log('[FlowLogin] ✅ Token saved successfully');
        onUserUpdate(result.user);
        
        // Save session and update status
        await saveFlowSession();
        await checkLoginStatus();
        
        // Show success notification
        const successMsg = document.createElement('div');
        successMsg.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-zoomIn';
        successMsg.textContent = T.loginSuccess + ' Token updated!';
        document.body.appendChild(successMsg);
        setTimeout(() => {
          if (document.body.contains(successMsg)) {
            document.body.removeChild(successMsg);
          }
        }, 3000);
        
      } else {
        throw new Error(result.message || 'Failed to save token');
      }
    } catch (error) {
      console.error('[FlowLogin] Error saving token:', error);
      setLoginError(error instanceof Error ? error.message : 'Failed to save token');
    } finally {
      setIsExtractingToken(false);
    }
  };

  const handleCopyToken = async () => {
    if (!extractedToken) {
      setLoginError('No token to copy. Please check the iframe below.');
      return;
    }

    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(extractedToken);
      
      // Show success message
      const successMsg = document.createElement('div');
      successMsg.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-zoomIn';
      successMsg.textContent = 'Token copied and filled! Click Save above to update.';
      document.body.appendChild(successMsg);
      setTimeout(() => {
        if (document.body.contains(successMsg)) {
          document.body.removeChild(successMsg);
        }
      }, 3000);
    } catch (error) {
      console.error('[FlowLogin] Error copying token:', error);
      setLoginError('Failed to copy token. Please copy manually from iframe.');
    }
  };


  const handleLogout = async () => {
    try {
      await clearFlowSession();
      setIsLoggedIn(false);
      alert(T.logoutSuccess);
    } catch (error) {
      console.error('[FlowLogin] Error logging out:', error);
      setLoginError('Failed to logout');
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">
            {T.title}
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {T.description}
          </p>
        </div>
      </div>

      {/* Status Display */}
      <div className="mb-4 p-4 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
        {isChecking ? (
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <Spinner />
            <span>{T.status.checking}</span>
          </div>
        ) : isLoggedIn ? (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-5 h-5" />
            <span>{T.status.loggedIn}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <XIcon className="w-5 h-5" />
            <span>{T.status.notLoggedIn}</span>
          </div>
        )}
      </div>

      {/* Error Message */}
      {loginError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{loginError}</p>
        </div>
      )}

      {/* Token Extraction Progress */}
      {isExtractingToken && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <Spinner />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Extracting token from popup window...
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                A popup window has been opened with the session API. Token will be extracted automatically.
              </p>
            </div>
            <button
              onClick={() => {
                if (tokenPopupRef.current && !tokenPopupRef.current.closed) {
                  tokenPopupRef.current.close();
                }
                setIsExtractingToken(false);
              }}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
              title="Cancel"
            >
              <XIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="bg-white dark:bg-neutral-800 rounded p-3 border border-blue-200 dark:border-blue-700">
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2">
              <strong>Automatic Extraction in Progress:</strong>
            </p>
            <ul className="text-xs text-neutral-600 dark:text-neutral-400 ml-4 list-disc space-y-1">
              <li>Token extraction is happening automatically in the background</li>
              <li>A small popup window may appear briefly (will auto-close)</li>
              <li>Token will be automatically filled in the Personal Auth Token field above</li>
              <li>No manual action required - just wait a few seconds</li>
            </ul>
          </div>
        </div>
      )}

      {/* Extracted Token Display */}
      {extractedToken && !isExtractingToken && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-900 dark:text-green-100">
              Token extracted successfully!
            </span>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-semibold text-green-800 dark:text-green-200 mb-2">
              Extracted Access Token:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={extractedToken}
                className="flex-1 bg-white dark:bg-neutral-800 border border-green-300 dark:border-green-700 rounded-lg p-2 text-xs font-mono text-green-900 dark:text-green-100"
              />
              <button
                onClick={handleCopyToken}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <ClipboardIcon className="w-4 h-4" />
                Copy & Save
              </button>
            </div>
            <p className="text-xs text-green-700 dark:text-green-300 mt-2">
              Token has been automatically filled in the Personal Auth Token field above. Click "Save" to update.
            </p>
          </div>
        </div>
      )}

      {/* Confirm Login Button (after popup closed) */}
      {showConfirmButton && !isLoggingIn && !isExtractingToken && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-900 dark:text-green-100">
                Popup window closed
              </p>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                If you completed the login, click the button below to save your session.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmLogin}
              disabled={isExtractingToken}
              className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isExtractingToken ? (
                <>
                  <Spinner />
                  <span>Extracting...</span>
                </>
              ) : (
                <>
                  <CheckCircleIcon className="w-4 h-4" />
                  Yes, I've logged in - Save Session & Extract Token
                </>
              )}
            </button>
            <button
              onClick={() => setShowConfirmButton(false)}
              className="px-4 py-2 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-semibold rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Login Progress */}
      {isLoggingIn && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <Spinner />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {T.loginInProgress}
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                A popup window has been opened. Please complete the login process there.
              </p>
            </div>
            <button
              onClick={() => {
                if (popupRef.current && !popupRef.current.closed) {
                  popupRef.current.close();
                }
                setIsLoggingIn(false);
              }}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
              title="Cancel"
            >
              <XIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="bg-white dark:bg-neutral-800 rounded p-3 border border-blue-200 dark:border-blue-700">
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2">
              <strong>Instructions:</strong>
            </p>
            <ol className="text-xs text-neutral-600 dark:text-neutral-400 mb-3 ml-4 list-decimal space-y-1">
              <li>Complete login in the popup window</li>
              <li>Wait until you see the Flow project page (with textarea and generate button)</li>
              <li>Close the popup window</li>
              <li>Click the button below to confirm login</li>
            </ol>
            <button
              onClick={handleConfirmLogin}
              disabled={isExtractingToken}
              className="w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isExtractingToken ? (
                <>
                  <Spinner />
                  <span>Extracting token...</span>
                </>
              ) : (
                <>
                  <CheckCircleIcon className="w-4 h-4" />
                  I've completed login - Save Session & Extract Token
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        {isLoggedIn ? (
          <>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <XIcon className="w-4 h-4" />
              {T.logoutButton}
            </button>
            <button
              onClick={checkLoginStatus}
              disabled={isChecking}
              className="px-4 py-2 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-semibold rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCwIcon className="w-4 h-4" />
              Refresh
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleLogin}
              disabled={isLoggingIn || isChecking}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {isLoggingIn ? (
                <>
                  <Spinner />
                  <span>{T.loginInProgress}</span>
                </>
              ) : (
                <>
                  <ExternalLinkIcon className="w-4 h-4" />
                  {T.loginButton}
                </>
              )}
            </button>
            <button
              onClick={checkLoginStatus}
              disabled={isChecking}
              className="px-4 py-2 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-sm font-semibold rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors flex items-center gap-2 disabled:opacity-50"
              title="Refresh login status"
            >
              <RefreshCwIcon className="w-4 h-4" />
              Refresh Status
            </button>
          </>
        )}
      </div>

      {/* Info Box */}
      {!isLoggingIn && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-xs text-blue-800 dark:text-blue-200 mb-2">
            <strong>Why popup window?</strong> Google blocks embedding Flow in iframe for security reasons (X-Frame-Options). 
            This is a standard security measure to prevent clickjacking attacks.
          </p>
          <p className="text-xs text-blue-800 dark:text-blue-200">
            <strong>Note:</strong> After logging in the popup, close it and your session will be saved automatically. 
            You may need to log in again if your session expires. This login is required for Flow automation features.
          </p>
        </div>
      )}
    </div>
  );
};

export default FlowLogin;

