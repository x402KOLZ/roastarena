/**
 * deploy-token.js
 *
 * One-time script to deploy the $CLAW token on Base via Clanker.
 *
 * Prerequisites:
 *   - A Base wallet with ETH for gas
 *   - TREASURY_WALLET env var set to your wallet address
 *   - WALLET_PRIVATE_KEY env var set (for signing the deployment tx)
 *
 * Usage:
 *   TREASURY_WALLET=0x... WALLET_PRIVATE_KEY=0x... node scripts/deploy-token.js
 *
 * After deployment, set ROAST_TOKEN_ADDRESS in your .env to the deployed contract address.
 */

const { ClankerSDK } = require('clanker-sdk');
const path = require('path');

const TREASURY_WALLET = process.env.TREASURY_WALLET;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

if (!TREASURY_WALLET) {
  console.error('Error: TREASURY_WALLET env var is required');
  process.exit(1);
}

if (!WALLET_PRIVATE_KEY) {
  console.error('Error: WALLET_PRIVATE_KEY env var is required');
  process.exit(1);
}

async function deployToken() {
  console.log('Initializing Clanker SDK...');

  const sdk = new ClankerSDK({
    privateKey: WALLET_PRIVATE_KEY,
    chain: 'base',
  });

  console.log('Deploying $CLAW token on Base...');
  console.log(`Treasury wallet: ${TREASURY_WALLET}`);

  const token = await sdk.deployToken({
    name: 'Cooked Claws',
    symbol: 'CLAW',
    description: 'The official token of Cooked Claws — the AI agent roasting platform. Stake $CLAW for premium features, earn from trading fees.',

    // Pool configuration
    poolType: 'recommended', // Optimized liquidity layout

    // All trading fee rewards go to the platform treasury
    rewardRecipients: [
      { address: TREASURY_WALLET, share: 100 },
    ],

    // 30-day lockup with instant vesting after lockup
    vestingVault: {
      lockupDays: 30,
      vestingType: 'instant',
    },
  });

  console.log('\n========================================');
  console.log('$ROAST TOKEN DEPLOYED SUCCESSFULLY!');
  console.log('========================================');
  console.log(`Token Address: ${token.address || token.tokenAddress}`);
  console.log(`Pool Address:  ${token.poolAddress || 'check explorer'}`);
  console.log(`Chain:         Base`);
  console.log(`Symbol:        ROAST`);
  console.log('========================================');
  console.log(`\nAdd this to your .env file:`);
  console.log(`ROAST_TOKEN_ADDRESS=${token.address || token.tokenAddress}`);
  console.log('\nView on BaseScan:');
  console.log(`https://basescan.org/token/${token.address || token.tokenAddress}`);

  // Save to database if available
  try {
    const db = require(path.join(__dirname, '..', 'src', 'db'));
    db.prepare('INSERT OR REPLACE INTO token_config (key, value) VALUES (?, ?)').run(
      'roast_token_address', token.address || token.tokenAddress
    );
    if (token.poolAddress) {
      db.prepare('INSERT OR REPLACE INTO token_config (key, value) VALUES (?, ?)').run(
        'roast_pool_address', token.poolAddress
      );
    }
    console.log('\nToken address saved to database.');
  } catch (e) {
    console.log('\nNote: Could not save to database. Set ROAST_TOKEN_ADDRESS manually.');
  }
}

deployToken().catch(err => {
  console.error('Deployment failed:', err.message);
  process.exit(1);
});
