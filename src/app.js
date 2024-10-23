import { request } from 'graphql-request';
import { getPoolsQuery } from './graphqlQuery.js';
import { fetchTokenPrices } from './priceFetcher.js';
import { calculateAPR } from './aprCalculator.js';
import fs from 'fs';
import { config } from "dotenv";
import path from "path";

// Load env
config();

// Ensure all required environment variables are set before the application starts
const req_env = ["UNISWAP_V3_SUBGRAPH_URL", "COINGECKO_API_URL", "CACHE_FILENAME"];
for(env in req_env) {
    if(!process.env[env]) {
        throw new Error(`Missing required environment variable: ${env}`);
    }
}

// GraphQL endpoint for Uniswap V3 on Ethereum Mainnet
const UNISWAP_V3_SUBGRAPH_URL = process.env.UNISWAP_V3_SUBGRAPH_URL;

// Define thresholds for filtering pools
const liquidityThreshold = 50000; // Minimum liquidity
const volumeThreshold = 1000;      // Minimum volume
const aprPercentageThreshold = 0.05; // Minimum APR percentage
const aprMaxValue = 200; // Maximum APR percentage

// Global variable to define the limit
const LIMIT = 100000;
const CACHE_FILE = path.join(path.dirname, "../", process.env.CACHE_FILENAME);  // Path for the cache file

// Utility function to format large numbers with commas and appropriate suffixes
export function formatBigNumber(number, decimals = 2) {
    if (!number || isNaN(number)) {
        return "N/A";  // Return a default value for invalid numbers
    }
    
    const suffixes = ["", "K", "M", "B", "T", "P", "E"];
    let tier = Math.log10(Math.abs(number)) / 3 | 0;
    if (tier == 0) return number.toFixed(decimals);
    
    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    const scaledNumber = number / scale;
    
    return scaledNumber.toFixed(decimals) + suffix;
}

/**
 * Determines if a pool meets certain criteria based on liquidity, daily volume, 
 * APR, and thresholds. A significant pool is defined as one that has a sufficient 
 * amount of total value locked in USD, a high enough daily volume in USD, 
 * an APR above the minimum threshold, and APR below a maximum allowed value.
 *
 * @param {object} pool - The pool object to check.
 * @returns {boolean} True if the pool is significant, false otherwise.
 */
export function isPoolSignificant(pool) {
    // Extract relevant values from the pool object
    const totalValueLockedUSD = pool.totalValueLockedUSD;
    const dailyVolumeUSD = pool.volumeUSD;

    // Prevent division by zero or very small numbers in APR calculation
    const liquidity = (pool.liquidity > 0) ? pool.liquidity : 1; // Use a default value for liquidity if it's 0
    const apr = calculateAPR(pool.feeTier, dailyVolumeUSD, liquidity);

    // Check if the pool meets all the criteria
    if (
        // Daily volume must be truthy and not NaN
        dailyVolumeUSD &&
        !isNaN(dailyVolumeUSD) &&
        // Total value locked in USD must meet or exceed the liquidity threshold
        totalValueLockedUSD >= liquidityThreshold &&
        // Daily volume in USD must meet or exceed the volume threshold
        dailyVolumeUSD >= volumeThreshold &&
        // APR must be above the minimum threshold and below the maximum allowed value
        apr >= aprPercentageThreshold &&
        apr < aprMaxValue && 
        // Ensure APR is not Infinity (which could indicate an error)
        apr !== Infinity
    ) {
        return true;
    }
    return false;
}


// Function to introduce delay to respect API rate limits
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fetch all pools with pagination and a limit
async function fetchAllPools(limit = LIMIT, rateLimitDelayMs = 100) {
    let allPools = [];
    let lastPoolId = "";  // Used for pagination
    let fetchMore = true;
    const batchSize = 50; // Number of pools to fetch per request
    const significantPoolsSet = new Set(); // To store significant pool IDs to prevent duplicates
    let significantPools = []; // Array for storing detailed pool data
    
    try {
        while (fetchMore && allPools.length < limit) {
            // Step 1: Generate the paginated query for fetching pools
            const query = getPoolsQuery(batchSize, lastPoolId, liquidityThreshold, volumeThreshold);
            
            // Step 2: Fetch a batch of pools
            const data = await request(UNISWAP_V3_SUBGRAPH_URL, query);
            
            // Step 3: Process each pool individually
            for (const pool of data.pools) {
                allPools.push(pool);  // Add pool to the list of all fetched pools
                
                // Update lastPoolId for pagination
                lastPoolId = pool.id;
                
                // Test if the pool is significant and not already processed
                if (isSignificantPool(pool) && !significantPoolsSet.has(pool.id)) {
                    significantPoolsSet.add(pool.id);
                    significantPools.push(pool);
                    console.log(`Significant pool found: ${pool.id}`);
                }
                
                // Stop fetching if we reach the limit
                if (allPools.length >= limit) {
                    fetchMore = false;
                    break;
                }
            }
            
            // Step 4: Check if we should stop fetching
            if (data.pools.length < batchSize) {
                fetchMore = false; // Stop fetching if we've reached the limit or there are no more pools
            }
            
            // Step 5: Respect rate limit by introducing a delay
            await delay(rateLimitDelayMs);
        }
    } catch (error) {
        console.error("Error fetching pools with pagination:", error);
    }
    
    return significantPools; // Return the significant pools only
}

// Save the significant pools to the cache file
function saveToCache(significantPools) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(significantPools, null, 2));
        console.log("Significant pools have been cached.");
    } catch (error) {
        console.error("Error saving significant pools to cache:", error);
    }
}

// Load the significant pools from the cache file
function loadFromCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf-8');
            return JSON.parse(data);
        } else {
            console.log("No cache file found. Please fetch live data.");
            return null;
        }
    } catch (error) {
        console.error("Error loading pools from cache:", error);
        return null;
    }
}

/**
 * Fetches significant pool data along with their respective token prices, 
 * liquidity in USD, 24h volume, 1Day Vol/TVL ratio, and APR for the Ethereum mainnet.
 * 
 * @param {number} limit - The maximum number of pools to fetch (default is set by LIMIT).
 * @param {boolean} useCache - If true, loads data from cache; otherwise, fetches live data.
 * @returns {object[]} An array of significant pool objects with enhanced information.
 */
async function fetchPoolsPricesAndAPR(limit = LIMIT, useCache = false) {
    try {
        let significantPools = [];
        
        // Step 1: Load from cache if specified
        if (useCache) {
            console.log("Loading significant pools from cache...");
            
            const cachedPools = loadFromCache();
            if (cachedPools && cachedPools.length > 0) {
                significantPools = cachedPools.filter(pool => isSignificantPool(pool));
                console.log("Loaded significant pools from cache.");
            } else {
                console.log("No significant pools found in cache. Fetching live data...");
                useCache = false;  // Fall back to live data
            }
        }
        
        // Step 2: Fetch live data if not using cache
        if (!useCache) {
            console.log("Fetching live data...");
            
            significantPools = await fetchAllPools(limit);
            
            // Step 3: Save significant pools to cache
            saveToCache(significantPools);
        }
        
        // Step 4: If there are no significant pools, skip fetching token prices
        if (significantPools.length === 0) {
            console.log("No significant pools found based on the criteria (Liquidity, Volume, and APR).");
            return;
        }
        
        // Step 5: Collect all token addresses from significant pools only
        const tokenAddresses = [
            ...new Set(significantPools.flatMap(pool => [pool.token0.id, pool.token1.id]))
        ];
        
        // Step 6: Fetch token prices only for significant pools
        const tokenPrices = await fetchTokenPrices(tokenAddresses);
        
        // Step 7: Display pool data along with token prices, APR, and 1Day Vol/TVL for significant pools
        console.log("Significant Pools on Ethereum Mainnet (Filtered by Liquidity, Volume & APR):");
        significantPools = significantPools.map(pool => {
            const token0Price = tokenPrices[pool.token0.id.toLowerCase()]?.usd || 0;
            const token1Price = tokenPrices[pool.token1.id.toLowerCase()]?.usd || 0;
            
            // If token0Price or token1Price is too close to zero, skip this pool
            if (token0Price < 1e-6 || token1Price < 1e-6) {
                return null;
            }
            
            // Estimate liquidity in USD (using the token with the highest price)
            const totalValueLockedUSD = parseFloat(pool.totalValueLockedUSD);
            
            // Ensure that both totalValueLockedUSD and volumeUSD are valid numbers
            const volumeUSD = parseFloat(pool.volumeUSD);
            if (!totalValueLockedUSD || !volumeUSD) {
                return null; // Skip pools with invalid liquidity or volume data
            }
            
            // Calculate 1Day Vol/TVL ratio, ensuring both are in the same base unit (USD)
            const oneDayVolTVL = (volumeUSD / totalValueLockedUSD) * 100; // Convert to percentage
            
            // Prevent division by zero in APR calculation
            const liquidity = pool.liquidity > 0 ? pool.liquidity : 1;
            const apr = parseFloat(calculateAPR(pool.feeTier, pool.volumeUSD, liquidity));
            
            // Display the pool's information with refined formatting
            console.log(`- ${pool.token0.symbol} / ${pool.token1.symbol}`);
            console.log(`  ID: ${pool.id}`);
            console.log(`  Token 0: ${pool.token0.name} - $${token0Price.toFixed(8)}`); // Plain number formatting for token prices
            console.log(`  Token 1: ${pool.token1.name} - $${token1Price.toFixed(8)}`); // Plain number formatting for token prices
            console.log(`  Total Value Locked (USD): ${formatBigNumber(totalValueLockedUSD, 8)}`);
            console.log(`  Fee Tier: ${(pool.feeTier / 10000).toFixed(2)}%`); // Plain percentage formatting for fee tier
            console.log(`  24h Volume: $${formatBigNumber(volumeUSD, 2)}`);
            console.log(`  1Day Vol/TVL: ${oneDayVolTVL.toFixed(2)}%`); // Display as percentage
            console.log(`  APR: ${apr.toFixed(2)}%`); // Plain percentage formatting for APR
            
            // Return updated pool with additional information
            return {
                ...pool,
                token0Price,
                token1Price,
                apr: apr,
                oneDayVolTVL,
                volumeUSD: pool.volumeUSD,
                totalValueLockedUSD: pool.totalValueLockedUSD
            };
        });
        
        saveToCache(significantPools);
        
    } catch (error) {
        console.error("Error fetching pools, token prices, or calculating APR:", error);
    }
}


// Choose whether to load live data or from the cache
const args = process.argv.slice(2);
const useCache = args.includes("--use-cache");
const showHelp = args.includes("--help") || args.includes("-h");

if (showHelp) {
    console.log("\nUsage: node app.js [options]\n");
    console.log("Options:");
    console.log("--use-cache\tLoad data from cache instead of fetching live data.");
    console.log("--help\t\tShow this help message.\n");
} else  {
    fetchPoolsPricesAndAPR(LIMIT, useCache); // Pass 'useCache' based on the user's choice
}
