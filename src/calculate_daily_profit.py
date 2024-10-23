import json
import os
import matplotlib.pyplot as plt
import pathlib

# ----------------------------
# Definitions and Formulas
# ----------------------------

# Start Position (in USD)
START_POSITION = 100.0

# Number of Days to Simulate
NUM_DAYS = 365

# Cached File Path
# Get the value of the environment variable
cache_filename = os.environ.get('CACHE_FILENAME')
CACHE_FILE = pathlib.Path.cwd().joinpath('../', cache_filename)

# ----------------------------
# Function Definitions
# ----------------------------

def load_cached_pools(cache_file):
    """
    Load cached significant pools from a JSON file.
    
    Parameters:
        cache_file (str): Path to the cached JSON file.
        
    Returns:
        list: List of pool dictionaries.
    """
    if not os.path.exists(cache_file):
        raise FileNotFoundError(f"Cache file '{cache_file}' not found.")
    
    with open(cache_file, 'r') as file:
        try:
            pools = json.load(file)
            return pools
        except json.JSONDecodeError as e:
            raise ValueError(f"Error decoding JSON: {e}")

def calculate_daily_profit(apr, start_position):
    """
    Calculate the daily profit based on APR and start position.
    
    Parameters:
        apr (float): Annual Percentage Rate (e.g., 11.54 for 11.54%).
        start_position (float): Initial investment amount in USD.
        
    Returns:
        float: Daily profit in USD.
    """
    daily_rate = apr / 100 / 365  # Convert APR to daily rate
    daily_profit = start_position * daily_rate
    return daily_profit

def simulate_cumulative_profit(daily_profit, num_days):
    """
    Simulate cumulative profit over a number of days.
    
    Parameters:
        daily_profit (float): Profit earned each day in USD.
        num_days (int): Number of days to simulate.
        
    Returns:
        list: Cumulative profit for each day.
    """
    cumulative_profits = []
    cumulative_total = 0  # Track the cumulative total profit
    for day in range(1, num_days + 1):
        cumulative_total += daily_profit
        cumulative_profits.append(cumulative_total)
    return cumulative_profits

def print_pool_profit_table(pools):
    """
    Print a table of pool addresses, pairs, APRs, and cumulative profits
    in order of the best cumulative profit.
    
    Parameters:
        pools (list): List of pool dictionaries.
    """
    pool_data = []

    # Calculate cumulative profit for each pool
    for pool in pools:
        try:
            token0 = pool['token0']['symbol']
            token1 = pool['token1']['symbol']
            pair_name = f"{token0} / {token1}"
            apr = float(pool['apr'])  # Ensure APR is a float
            daily_profit = calculate_daily_profit(apr, START_POSITION)
            cumulative_profits = simulate_cumulative_profit(daily_profit, NUM_DAYS)
            cumulative_profit = cumulative_profits[-1]  # Take the last day's cumulative profit
            pool_data.append({
                'address': pool['id'],
                'pair': pair_name,
                'apr': apr,
                'cumulative_profit': cumulative_profit
            })
        except (KeyError, ValueError, TypeError) as e:
            print(f"Skipping pool due to missing data: {e}")
            continue

    # Sort by cumulative profit in descending order
    sorted_pools = sorted(pool_data, key=lambda x: x['cumulative_profit'], reverse=True)

    # Print table header
    print(f"{'Pool Address':<42} {'Pair':<20} {'APR (%)':>10} {'Cumulative Profit ($)':>22}")
    print("-" * 80)

    # Print each pool's information
    for pool in sorted_pools:
        print(f"{pool['address']:<42} {pool['pair']:<20} {pool['apr']:>10.2f} {pool['cumulative_profit']:>22.2f}")

# ----------------------------
# Main Execution
# ----------------------------

def main():
    # Load cached pools
    try:
        pools = load_cached_pools(CACHE_FILE)
    except (FileNotFoundError, ValueError) as e:
        print(e)
        return
    
    if not pools:
        print("No pools found in the cache.")
        return
    
    # Print the table of pools sorted by cumulative profit
    print_pool_profit_table(pools)
    
    # Initialize plot
    plt.figure(figsize=(12, 8))
    
    for pool in pools:
        try:
            # Extract necessary information
            token0 = pool['token0']['symbol']
            token1 = pool['token1']['symbol']
            pair_name = f"{token0} / {token1}"
            apr = float(pool['apr'])  # Ensure APR is a float
        except (KeyError, ValueError, TypeError) as e:
            print(f"Skipping pool due to missing data: {e}")
            continue
        
        # Calculate daily profit
        daily_profit = calculate_daily_profit(apr, START_POSITION)
        
        # Simulate cumulative profit (consistent with the table)
        cumulative_profit = simulate_cumulative_profit(daily_profit, NUM_DAYS)
        
        # Generate day numbers
        days = list(range(1, NUM_DAYS + 1))
        
        # Plot cumulative profit
        plt.plot(days, cumulative_profit, label=pair_name)
    
    # Configure plot
    plt.title("Cumulative Daily Profit from Providing Liquidity to Uniswap Pools")
    plt.xlabel("Day Number")
    plt.ylabel("Cumulative Profit (USD)")
    plt.legend(title="Pool Pairs", fontsize='small', loc='upper left', bbox_to_anchor=(1, 1))
    plt.grid(True)
    plt.tight_layout()  # Adjust layout to prevent clipping of legend
    
    # Display plot
    # plt.show()
    plt.savefig("cumulative_profit.png")

if __name__ == "__main__":
    main()
