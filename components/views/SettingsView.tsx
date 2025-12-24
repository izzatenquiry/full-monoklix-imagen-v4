
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { type User, type AiLogItem, type Language } from '../../types';
import { updateUserProfile, saveUserPersonalAuthToken, assignPersonalTokenAndIncrementUsage } from '../../services/userService';
import {
    CreditCardIcon, CheckCircleIcon, XIcon, EyeIcon, EyeOffIcon, ChatIcon,
    AlertTriangleIcon, DatabaseIcon, TrashIcon, RefreshCwIcon, WhatsAppIcon, InformationCircleIcon, SparklesIcon, VideoIcon, ImageIcon, KeyIcon, ActivityIcon, ServerIcon
} from '../Icons';
import Spinner from '../common/Spinner';
import Tabs, { type Tab } from '../common/Tabs';
import { getTranslations } from '../../services/translations';
import { getFormattedCacheStats, clearVideoCache } from '../../services/videoCacheService';
import { runComprehensiveTokenTest, type TokenTestResult } from '../../services/imagenV3Service';
import eventBus from '../../services/eventBus';
import { GalleryView } from './GalleryView';
import FlowLogin from '../FlowLogin';

// Define the types for the settings view tabs
type SettingsTabId = 'profile' | 'flow-api';

const getTabs = (): Tab<SettingsTabId>[] => {
    const T = getTranslations().settingsView;
    return [
        { id: 'profile', label: T.tabs.profile },
        { id: 'flow-api', label: 'Login Labs.Google' },
    ];
}

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface SettingsViewProps {
  currentUser: User;
  tempApiKey: string | null;
  onUserUpdate: (user: User) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  veoTokenRefreshedAt: string | null;
  assignTokenProcess: () => Promise<{ success: boolean; error: string | null; }>;
  onOpenChangeServerModal?: () => void;
}

const ClaimTokenModal: React.FC<{
  status: 'searching' | 'success' | 'error';
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}> = ({ status, error, onRetry, onClose }) => {
    const T = getTranslations().claimTokenModal;
    return (
    <div className="fixed inset-0 bg-black/70 flex flex-col items-center justify-center z-50 p-4 animate-zoomIn" aria-modal="true" role="dialog">
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl p-8 text-center max-w-sm w-full">
        {status === 'searching' && (
            <>
            <Spinner />
            <h2 className="text-xl font-bold mt-4">{T.searchingTitle}</h2>
            <p className="text-neutral-500 dark:text-neutral-400 mt-2 text-sm">
                {T.searchingMessage}
            </p>
            </>
        )}
        {status === 'success' && (
            <>
            <CheckCircleIcon className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold mt-4">{T.successTitle}</h2>
            <p className="text-neutral-500 dark:text-neutral-400 mt-2 text-sm">
                {T.successMessage}
            </p>
            </>
        )}
        {status === 'error' && (
            <>
            <AlertTriangleIcon className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold mt-4">{T.errorTitle}</h2>
            <p className="text-neutral-500 dark:text-neutral-400 mt-2 text-sm">
                {error || T.errorMessageDefault}
            </p>
            <div className="mt-6 flex gap-4">
                <button onClick={onClose} className="w-full bg-neutral-200 dark:bg-neutral-700 font-semibold py-2 px-4 rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors">
                {T.closeButton}
                </button>
                <button onClick={onRetry} className="w-full bg-primary-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-primary-700 transition-colors">
                {T.retryButton}
                </button>
            </div>
            </>
        )}
        </div>
    </div>
)};

// --- PANELS ---

interface ProfilePanelProps extends Pick<SettingsViewProps, 'currentUser' | 'onUserUpdate' | 'assignTokenProcess' | 'onOpenChangeServerModal'> {
    language: Language;
    setLanguage: (lang: Language) => void;
}

interface FlowApiPanelProps extends Pick<SettingsViewProps, 'currentUser' | 'onUserUpdate' | 'language'> {
    assignTokenProcess: () => Promise<{ success: boolean; error: string | null; }>;
}

const FlowApiPanel: React.FC<FlowApiPanelProps> = ({ currentUser, onUserUpdate, language, assignTokenProcess }) => {
    const T = getTranslations().settingsView;
    const T_Api = T.api;

    const [personalAuthToken, setPersonalAuthToken] = useState('');
    const [showPersonalToken, setShowPersonalToken] = useState(false);
    const [personalTokenSaveStatus, setPersonalTokenSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle');
    const [testResults, setTestResults] = useState<TokenTestResult[] | null>(null);
    const activeApiKey = sessionStorage.getItem('monoklix_session_api_key');

    const handleSavePersonalToken = async () => {
        setPersonalTokenSaveStatus('saving');
        const result = await saveUserPersonalAuthToken(currentUser.id, personalAuthToken.trim() || null);

        if (result.success === false) {
            setPersonalTokenSaveStatus('error');
            if (result.message === 'DB_SCHEMA_MISSING_COLUMN_personal_auth_token' && currentUser.role === 'admin') {
                alert("Database schema is outdated.\n\nPlease go to your Supabase dashboard and run the following SQL command to add the required column:\n\nALTER TABLE public.users ADD COLUMN personal_auth_token TEXT;");
            }
        } else {
            onUserUpdate(result.user);
            setPersonalTokenSaveStatus('saved');
        }
        setTimeout(() => setPersonalTokenSaveStatus('idle'), 3000);
    };

    const handleTestToken = useCallback(async () => {
        setTestStatus('testing');
        setTestResults(null);
        const results = await runComprehensiveTokenTest(personalAuthToken);
        setTestResults(results);
        setTestStatus('idle');
    }, [personalAuthToken]);

    const handleClearToken = async () => {
        if (!confirm('Are you sure you want to clear the personal token? This will remove your saved token.')) {
            return;
        }
        setPersonalTokenSaveStatus('saving');
        setPersonalAuthToken('');
        setTestResults(null);
        const result = await saveUserPersonalAuthToken(currentUser.id, null);

        if (result.success === false) {
            setPersonalTokenSaveStatus('error');
        } else {
            onUserUpdate(result.user);
            setPersonalTokenSaveStatus('saved');
        }
        setTimeout(() => setPersonalTokenSaveStatus('idle'), 3000);
    };

    return (
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-sm h-full overflow-y-auto">
            <div className="p-4 md:p-8 space-y-8">
                {/* Google Labs Flow Login & API Configuration Section */}
                <div className="bg-neutral-50 dark:bg-neutral-800/30 rounded-xl p-4 md:p-6 border border-neutral-200 dark:border-neutral-700">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <KeyIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Google Labs Flow & API Keys</h3>
                    </div>

                    <div className="space-y-6">
                        {/* Step 1: Flow Login */}
                        <div className="border-b border-neutral-200 dark:border-neutral-700 pb-6">
                            <FlowLogin 
                                language={language} 
                                currentUser={currentUser} 
                                onUserUpdate={onUserUpdate}
                                onTokenExtracted={(token) => {
                                    setPersonalAuthToken(token);
                                }}
                            />
                        </div>

                        {/* Step 2: Personal Token Input */}
                        <div className="space-y-4">
                            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                {T_Api.authTokenTitle}
                            </label>
                                <div className="relative">
                                    <input
                                        type={showPersonalToken ? 'text' : 'password'}
                                        value={personalAuthToken}
                                        onChange={(e) => {
                                            setPersonalAuthToken(e.target.value);
                                            setTestResults(null);
                                        }}
                                        placeholder={T_Api.authTokenPlaceholder}
                                        className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-3 pr-12 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all font-mono text-sm"
                                    />
                                    <button 
                                        onClick={() => setShowPersonalToken(!showPersonalToken)} 
                                        className="absolute inset-y-0 right-0 px-4 flex items-center text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                                    >
                                        {showPersonalToken ? <EyeOffIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}
                                    </button>
                                </div>
                                
                                {testStatus === 'testing' && (
                                    <div className="flex items-center gap-2 text-sm text-neutral-500 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3">
                                        <Spinner /> 
                                        <span>{T_Api.testing}</span>
                                    </div>
                                )}
                                
                                {testResults && (
                                    <div className="space-y-2">
                                        {testResults.map(result => (
                                            <div 
                                                key={result.service} 
                                                className={`flex items-start gap-3 text-sm p-3 rounded-lg border ${
                                                    result.success 
                                                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                                                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                                                }`}
                                            >
                                                {result.success ? (
                                                    <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5"/>
                                                ) : (
                                                    <XIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"/>
                                                )}
                                                <div className="flex-1">
                                                    <span className={`font-semibold block mb-1 ${
                                                        result.success 
                                                            ? 'text-green-800 dark:text-green-200' 
                                                            : 'text-red-700 dark:text-red-300'
                                                    }`}>
                                                        {result.service} Service
                                                    </span>
                                                    <p className={`text-xs ${
                                                        result.success 
                                                            ? 'text-green-700 dark:text-green-300' 
                                                            : 'text-red-600 dark:text-red-400'
                                                    }`}>
                                                        {result.message}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center gap-3 flex-wrap pt-2">
                                    <button 
                                        onClick={handleSavePersonalToken} 
                                        disabled={personalTokenSaveStatus === 'saving'} 
                                        className="px-5 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md flex items-center gap-2"
                                    >
                                        {personalTokenSaveStatus === 'saving' ? <Spinner /> : T_Api.save}
                                    </button>
                                    <button 
                                        onClick={handleTestToken} 
                                        disabled={!personalAuthToken || testStatus === 'testing'} 
                                        className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm hover:shadow-md"
                                    >
                                        {testStatus === 'testing' ? <Spinner /> : <SparklesIcon className="w-4 h-4" />}
                                        {T_Api.runTest}
                                    </button>
                                    <button 
                                        onClick={handleClearToken} 
                                        disabled={!personalAuthToken || personalTokenSaveStatus === 'saving'} 
                                        className="px-5 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm hover:shadow-md"
                                    >
                                        {personalTokenSaveStatus === 'saving' ? <Spinner /> : <XIcon className="w-4 h-4" />}
                                        Clear
                                    </button>
                                    
                                    {personalTokenSaveStatus === 'saved' && (
                                        <span className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                                            <CheckCircleIcon className="w-4 h-4"/> 
                                            {T_Api.updated}
                                        </span>
                                    )}
                                    {personalTokenSaveStatus === 'error' && (
                                        <span className="text-sm text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                            <XIcon className="w-4 h-4"/> 
                                            {T_Api.saveFail}
                                        </span>
                                    )}
                                </div>
                        </div>

                        {/* Step 3: Shared API Key Info */}
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                            <div className="flex items-start gap-3">
                                <InformationCircleIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">{T_Api.title}</p>
                                    <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                                        {T_Api.description}
                                    </p>
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        <span className="text-neutral-600 dark:text-neutral-400">{T_Api.sharedStatus}</span>
                                        {activeApiKey ? (
                                            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                                                <CheckCircleIcon className="w-4 h-4" />
                                                {T_Api.connected}
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-red-500">
                                                <XIcon className="w-4 h-4" />
                                                {T_Api.notLoaded}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ProfilePanel: React.FC<ProfilePanelProps> = ({ currentUser, onUserUpdate, language, setLanguage, assignTokenProcess, onOpenChangeServerModal }) => {
    const T = getTranslations().settingsView;
    const T_Profile = T.profile;
    const T_Api = T.api;

    const [fullName, setFullName] = useState(currentUser.fullName || currentUser.username);
    const [email, setEmail] = useState(currentUser.email);
    const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error' | 'loading'; message: string }>({ type: 'idle', message: '' });
    const statusTimeoutRef = useRef<number | null>(null);

    // API Configuration State
    const [personalAuthToken, setPersonalAuthToken] = useState(currentUser.personalAuthToken || '');
    const [showPersonalToken, setShowPersonalToken] = useState(false);
    const [personalTokenSaveStatus, setPersonalTokenSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle');
    const [testResults, setTestResults] = useState<TokenTestResult[] | null>(null);
    const [claimStatus, setClaimStatus] = useState<'idle' | 'searching' | 'success' | 'error'>('idle');
    const [claimError, setClaimError] = useState<string | null>(null);
    const activeApiKey = sessionStorage.getItem('monoklix_session_api_key');

     useEffect(() => {
        return () => {
            if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        const tokenFromProp = currentUser.personalAuthToken || '';
        setPersonalAuthToken(tokenFromProp);
        setTestResults(null);
    }, [currentUser.personalAuthToken]);

    const getAccountStatus = (user: User): { text: string; colorClass: string } => {
        switch (user.status) {
            case 'admin': return { text: T_Profile.status.admin, colorClass: 'text-green-500' };
            case 'lifetime': return { text: T_Profile.status.lifetime, colorClass: 'text-green-500' };
            case 'subscription': return { text: T_Profile.status.subscription, colorClass: 'text-green-500' };
            case 'trial': return { text: T_Profile.status.trial, colorClass: 'text-yellow-500' };
            case 'inactive': return { text: T_Profile.status.inactive, colorClass: 'text-red-500' };
            case 'pending_payment': return { text: T_Profile.status.pending, colorClass: 'text-yellow-500' };
            default: return { text: T_Profile.status.unknown, colorClass: 'text-neutral-500' };
        }
    };

    const handleSave = async () => {
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        setStatus({ type: 'loading', message: T_Profile.saving });
        const result = await updateUserProfile(currentUser.id, { fullName, email });
        if (result.success === false) {
            setStatus({ type: 'error', message: T_Profile.fail.replace('{message}', result.message) });
        } else {
            onUserUpdate(result.user);
            setStatus({ type: 'success', message: T_Profile.success });
        }
        statusTimeoutRef.current = window.setTimeout(() => setStatus({ type: 'idle', message: '' }), 4000);
    };

    const handleSavePersonalToken = async () => {
        setPersonalTokenSaveStatus('saving');
        const result = await saveUserPersonalAuthToken(currentUser.id, personalAuthToken.trim() || null);

        if (result.success === false) {
            setPersonalTokenSaveStatus('error');
            if (result.message === 'DB_SCHEMA_MISSING_COLUMN_personal_auth_token' && currentUser.role === 'admin') {
                alert("Database schema is outdated.\n\nPlease go to your Supabase dashboard and run the following SQL command to add the required column:\n\nALTER TABLE public.users ADD COLUMN personal_auth_token TEXT;");
            }
        } else {
            onUserUpdate(result.user);
            setPersonalTokenSaveStatus('saved');
        }
        setTimeout(() => setPersonalTokenSaveStatus('idle'), 3000);
    };

    const handleTestToken = useCallback(async () => {
        setTestStatus('testing');
        setTestResults(null);
        const results = await runComprehensiveTokenTest(personalAuthToken);
        setTestResults(results);
        setTestStatus('idle');
    }, [personalAuthToken]);

    const handleClaimNewToken = useCallback(async () => {
        setClaimStatus('searching');
        setClaimError(null);

        const clearResult = await saveUserPersonalAuthToken(currentUser.id, null);
        
        if (clearResult.success === false) {
            setClaimError(clearResult.message || 'Failed to clear previous token.');
            setClaimStatus('error');
        } else {
            onUserUpdate(clearResult.user);
            
            const assignResult = await assignTokenProcess();
            if (assignResult.success) {
                setClaimStatus('success');
                setTimeout(() => {
                    setClaimStatus('idle');
                }, 2000);
            } else {
                setClaimError(assignResult.error || 'Failed to assign token.');
                setClaimStatus('error');
            }
        }
    }, [currentUser.id, onUserUpdate, assignTokenProcess]);

    const accountStatus = getAccountStatus(currentUser);
    let expiryInfo = null;
    if (currentUser.status === 'subscription' && currentUser.subscriptionExpiry) {
        const expiryDate = new Date(currentUser.subscriptionExpiry);
        const isExpired = Date.now() > expiryDate.getTime();
        expiryInfo = (
            <span className={isExpired ? 'text-red-500 font-bold' : ''}>
                {T_Profile.expiresOn} {expiryDate.toLocaleDateString()} {isExpired && `(${T_Profile.expired})`}
            </span>
        );
    }

    return (
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-sm h-full overflow-y-auto">
            {claimStatus !== 'idle' && (
                <ClaimTokenModal
                    status={claimStatus}
                    error={claimError}
                    onClose={() => setClaimStatus('idle')}
                    onRetry={handleClaimNewToken}
                />
            )}

            <div className="p-4 md:p-8 space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-4">
                    <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{T_Profile.title}</h2>
                </div>

                {/* Account Status Card */}
                <div className="bg-gradient-to-r from-primary-50 to-blue-50 dark:from-primary-900/20 dark:to-blue-900/20 rounded-xl p-5 border border-primary-200 dark:border-primary-800">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <p className="text-xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wider mb-2">{T_Profile.accountStatus}</p>
                            <p className={`text-lg font-bold ${accountStatus.colorClass} mb-2`}>{accountStatus.text}</p>
                            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">
                                <span className="font-medium">Email:</span> {currentUser.email}
                            </p>
                            {expiryInfo && <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">{expiryInfo}</p>}
                        </div>
                        <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                            <CheckCircleIcon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                        </div>
                    </div>
                </div>

                {/* Server Selection Section */}
                {onOpenChangeServerModal && (
                    <div className="bg-neutral-50 dark:bg-neutral-800/30 rounded-xl p-4 md:p-6 border border-neutral-200 dark:border-neutral-700">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                <ServerIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Generation Server</h3>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="p-4 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
                                <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">Current Server</p>
                                <p className="text-sm font-mono text-neutral-700 dark:text-neutral-300">
                                    {typeof window !== 'undefined' && sessionStorage ? (sessionStorage.getItem('selectedProxyServer') || 'Auto-selected') : 'Auto-selected'}
                                </p>
                            </div>
                            
                            <button 
                                onClick={onOpenChangeServerModal}
                                className="w-full px-4 py-3 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
                            >
                                <ServerIcon className="w-4 h-4" />
                                Change Server
                            </button>
                            
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                Select a different proxy server for image and video generation. The system will automatically retry with different servers if one fails.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Usage Statistics / Credits - Hidden */}
            {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 border-t border-neutral-200 dark:border-neutral-800 pt-6">
                <div className="p-4 bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-800 rounded-lg flex items-center justify-between transition-all hover:border-blue-200 dark:hover:border-blue-900/50">
                    <div>
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Images Generated</p>
                        <p className="text-2xl font-bold text-neutral-800 dark:text-neutral-200">{currentUser.totalImage || 0}</p>
                    </div>
                    <div className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        <ImageIcon className="w-5 h-5" />
                    </div>
                </div>
                <div className="p-4 bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200 dark:border-neutral-800 rounded-lg flex items-center justify-between transition-all hover:border-purple-200 dark:hover:border-purple-900/50">
                    <div>
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Videos Generated</p>
                        <p className="text-2xl font-bold text-neutral-800 dark:text-neutral-200">{currentUser.totalVideo || 0}</p>
                    </div>
                    <div className="w-10 h-10 flex items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                        <VideoIcon className="w-5 h-5" />
                    </div>
                </div>
            </div> */}
        </div>
    );
};

const CacheManagerPanel: React.FC = () => {
    const T = getTranslations().settingsView.cache;
  const [stats, setStats] = useState<{
    size: string;
    count: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const formattedStats = await getFormattedCacheStats();
      setStats(formattedStats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleClearCache = async () => {
    if (!confirm(T.confirmClear)) {
      return;
    }

    setIsClearing(true);
    try {
      await clearVideoCache();
      await loadStats();
      alert(T.clearSuccess);
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert(T.clearFail);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-lg shadow-sm h-full">
        <div className="flex items-center gap-3 mb-6">
          <DatabaseIcon className="w-8 h-8 text-primary-500" />
          <div>
            <h2 className="text-xl font-semibold">{T.title}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {T.subtitle}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : stats ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-4">
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">{T.storageUsed}</p>
                <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{stats.size}</p>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-4">
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">{T.videosCached}</p>
                <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{stats.count}</p>
              </div>
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                {T.howItWorks}
              </h3>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li>{T.l1}</li>
                <li>{T.l2}</li>
                <li>{T.l3}</li>
                <li>{T.l4}</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button onClick={loadStats} disabled={isLoading} className="flex items-center justify-center gap-2 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 font-semibold py-2 px-4 rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors disabled:opacity-50">
                <RefreshCwIcon className="w-4 h-4" /> {T.refresh}
              </button>
              <button onClick={handleClearCache} disabled={isClearing || stats.count === 0} className="flex items-center justify-center gap-2 bg-red-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {isClearing ? (<><Spinner /> {T.clearing}</>) : (<><TrashIcon className="w-4 h-4" /> {T.clear}</>)}
              </button>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4">
              <h3 className="font-semibold mb-2">💡 {T.tips}</h3>
              <ul className="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
                <li>{T.tip1}</li>
                <li>{T.tip2}</li>
                <li>{T.tip3}</li>
                <li>{T.tip4}</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-neutral-500">{T.failLoad}</div>
        )}
      </div>
  );
};

const SettingsView: React.FC<SettingsViewProps> = ({ currentUser, tempApiKey, onUserUpdate, language, setLanguage, veoTokenRefreshedAt, assignTokenProcess, onOpenChangeServerModal }) => {
    const [activeTab, setActiveTab] = useState<SettingsTabId>('profile');
    const tabs = getTabs();
    const T = getTranslations().settingsView;

    const renderContent = () => {
        switch (activeTab) {
            case 'profile':
                return (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <ProfilePanel 
                            currentUser={currentUser} 
                            onUserUpdate={onUserUpdate} 
                            language={language} 
                            setLanguage={setLanguage}
                            assignTokenProcess={assignTokenProcess}
                            onOpenChangeServerModal={onOpenChangeServerModal}
                        />
                        <div className="h-full">
                            <CacheManagerPanel />
                        </div>
                    </div>
                );
            case 'flow-api':
                return (
                    <FlowApiPanel 
                        currentUser={currentUser} 
                        onUserUpdate={onUserUpdate} 
                        language={language}
                        assignTokenProcess={assignTokenProcess}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="flex-shrink-0 my-6 flex justify-center">
                <Tabs 
                    tabs={tabs}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    isAdmin={currentUser.role === 'admin' || currentUser.status === 'lifetime'}
                />
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {renderContent()}
            </div>
        </div>
    );
};

export default SettingsView;
