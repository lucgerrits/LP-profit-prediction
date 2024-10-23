import axios from 'axios';

const COINGECKO_API_URL = process.env.COINGECKO_API_URL;
const axiosInstance = axios.create({
    baseURL: COINGECKO_API_URL,
    headers: {
        ["x-cg-demo-api-key"]: process.env.COINGECKO_API_DEMO_KEY,
    },
});

// Helper function to introduce delay to respect rate limits
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to fetch token prices from CoinGecko in batches with rate limiting (5 requests/sec)
export async function fetchTokenPrices(tokenIds) {
    try {
        const batchSize = 10;
        const tokenPrices = {};
        
        for (let i = 0; i < tokenIds.length; i += batchSize) {
            const batch = tokenIds.slice(i, i + batchSize).join(',');
            const response = await axiosInstance.get(`${COINGECKO_API_URL}?contract_addresses=${batch.toLowerCase()}&vs_currencies=usd`);
            
            Object.assign(tokenPrices, response.data);  // Merge each batch's result into tokenPrices
            
            await delay(100);
        }
        
        return tokenPrices;
    } catch (error) {
        console.error("Error fetching token prices:", error);
        return {};
    }
}
