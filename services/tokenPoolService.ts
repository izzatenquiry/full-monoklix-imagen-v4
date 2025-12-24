/**
 * Token Pool Service - Manages a pool of random tokens for imagen generation
 * Fetches tokens from token_new_active table in Supabase and stores them in session storage
 */

const TOKEN_POOL_KEY = 'flow_token_pool';
const TOKEN_POOL_TIMESTAMP_KEY = 'flow_token_pool_timestamp';
const TOKEN_POOL_SIZE = 10; // Number of tokens to fetch and store
const TOKEN_POOL_EXPIRY_HOURS = 24; // Tokens expire after 24 hours

interface TokenPool {
  tokens: string[];
  timestamp: number;
}

/**
 * Fetch multiple tokens from token_new_active table and store in session storage
 */
export const fetchTokenPool = async (count: number = TOKEN_POOL_SIZE): Promise<string[]> => {
  console.log(`[TokenPool] Starting to fetch ${count} tokens from token_new_active table...`);
  
  try {
    const { supabase } = await import('./supabaseClient');
    
    // Fetch latest tokens from token_new_active table
    const { data, error } = await supabase
      .from('token_new_active')
      .select('token')
      .order('created_at', { ascending: false })
      .limit(count);

    if (error) {
      console.error('[TokenPool] Error fetching tokens from database:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.warn('[TokenPool] ⚠️ No tokens found in token_new_active table');
      return [];
    }

    // Extract token strings
    const tokens = data
      .map(item => item.token)
      .filter((token): token is string => 
        token && typeof token === 'string' && token.trim().length > 0 && token.startsWith('ya29.')
      );

    // Remove duplicates
    const uniqueTokens = Array.from(new Set(tokens));
    
    if (uniqueTokens.length > 0) {
      const pool: TokenPool = {
        tokens: uniqueTokens,
        timestamp: Date.now(),
      };
      
      try {
        sessionStorage.setItem(TOKEN_POOL_KEY, JSON.stringify(pool));
        sessionStorage.setItem(TOKEN_POOL_TIMESTAMP_KEY, Date.now().toString());
        console.log(`[TokenPool] ✅ Stored ${uniqueTokens.length} unique tokens in session storage`);
      } catch (storageError) {
        console.error('[TokenPool] Error storing tokens in sessionStorage:', storageError);
      }
    } else {
      console.warn('[TokenPool] ⚠️ No valid tokens found after filtering');
    }

    return uniqueTokens;
  } catch (error) {
    console.error('[TokenPool] Exception fetching token pool:', error);
    return [];
  }
};

/**
 * Get a random token from the pool
 */
export const getRandomToken = (): string | null => {
  try {
    const poolData = sessionStorage.getItem(TOKEN_POOL_KEY);
    if (!poolData) {
      console.log('[TokenPool] No token pool found in session storage');
      return null;
    }

    const pool: TokenPool = JSON.parse(poolData);
    
    // Check if pool is expired
    const expiryTime = TOKEN_POOL_EXPIRY_HOURS * 60 * 60 * 1000;
    if (Date.now() - pool.timestamp > expiryTime) {
      console.log('[TokenPool] Token pool expired, clearing...');
      clearTokenPool();
      return null;
    }

    if (!pool.tokens || pool.tokens.length === 0) {
      console.log('[TokenPool] Token pool is empty');
      return null;
    }

    // Get random token
    const randomIndex = Math.floor(Math.random() * pool.tokens.length);
    const token = pool.tokens[randomIndex];
    
    console.log(`[TokenPool] ✅ Retrieved random token (${randomIndex + 1}/${pool.tokens.length})`);
    return token;
  } catch (error) {
    console.error('[TokenPool] Error getting random token:', error);
    return null;
  }
};

/**
 * Get all tokens from the pool
 */
export const getAllTokens = (): string[] => {
  try {
    const poolData = sessionStorage.getItem(TOKEN_POOL_KEY);
    if (!poolData) {
      return [];
    }

    const pool: TokenPool = JSON.parse(poolData);
    
    // Check if pool is expired
    const expiryTime = TOKEN_POOL_EXPIRY_HOURS * 60 * 60 * 1000;
    if (Date.now() - pool.timestamp > expiryTime) {
      clearTokenPool();
      return [];
    }

    return pool.tokens || [];
  } catch (error) {
    console.error('[TokenPool] Error getting all tokens:', error);
    return [];
  }
};

/**
 * Clear the token pool
 */
export const clearTokenPool = (): void => {
  sessionStorage.removeItem(TOKEN_POOL_KEY);
  sessionStorage.removeItem(TOKEN_POOL_TIMESTAMP_KEY);
  console.log('[TokenPool] Token pool cleared');
};

/**
 * Check if token pool exists and is valid
 */
export const hasValidTokenPool = (): boolean => {
  try {
    const poolData = sessionStorage.getItem(TOKEN_POOL_KEY);
    if (!poolData) {
      return false;
    }

    const pool: TokenPool = JSON.parse(poolData);
    
    // Check if pool is expired
    const expiryTime = TOKEN_POOL_EXPIRY_HOURS * 60 * 60 * 1000;
    if (Date.now() - pool.timestamp > expiryTime) {
      return false;
    }

    return pool.tokens && pool.tokens.length > 0;
  } catch (error) {
    return false;
  }
};

/**
 * Get token pool size
 */
export const getTokenPoolSize = (): number => {
  try {
    const poolData = sessionStorage.getItem(TOKEN_POOL_KEY);
    if (!poolData) {
      return 0;
    }

    const pool: TokenPool = JSON.parse(poolData);
    return pool.tokens ? pool.tokens.length : 0;
  } catch (error) {
    return 0;
  }
};

