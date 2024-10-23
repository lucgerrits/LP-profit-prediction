import { gql } from 'graphql-request';

// Function to generate a paginated query for fetching pools
export const getPoolsQuery = (batchSize = 50, lastPoolId = "", liquidityThreshold = 1000000, volumeThreshold = 10000) => gql`
  {
    pools(
      first: ${batchSize}, 
      where: { 
        token0_not: null, 
        id_gt: "${lastPoolId}", 
        volumeUSD_gte: ${volumeThreshold}, 
        totalValueLockedUSD_gte: ${liquidityThreshold} 
      }
      orderBy: id,
      orderDirection: asc
    ) {
      id
      token0 {
        symbol
        id
        name
        decimals
      }
      token1 {
        symbol
        id
        name
        decimals
      }
      feeTier
      liquidity
      volumeUSD
      txCount
      totalValueLockedUSD
    }
  }
`;
