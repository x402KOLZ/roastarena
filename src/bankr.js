const BANKR_URL = process.env.BANKR_API_URL || 'https://api.bankr.bot';
const BANKR_KEY = process.env.BANKR_API_KEY; // bk_*

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

/**
 * Submit a natural language job to the Bankr Agent API.
 * Returns { jobId }.
 */
async function submitJob(prompt) {
  const res = await fetch(`${BANKR_URL}/v1/agent/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': BANKR_KEY,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bankr submit failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Poll a Bankr job until completion or failure.
 * Returns the completed job result.
 */
async function pollJob(jobId) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const res = await fetch(`${BANKR_URL}/v1/agent/status/${jobId}`, {
      headers: { 'x-api-key': BANKR_KEY },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Bankr poll failed (${res.status}): ${err}`);
    }

    const data = await res.json();

    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error(`Bankr job failed: ${data.error || 'unknown'}`);

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('Bankr job timed out after polling');
}

/**
 * Execute a Bankr command and wait for result.
 * Combines submit + poll into one call.
 */
async function execute(prompt) {
  const { jobId } = await submitJob(prompt);
  return pollJob(jobId);
}

/**
 * Check wallet balance for a specific token.
 */
async function checkBalance(walletAddress, token = 'USDC') {
  return execute(`What is the ${token} balance of wallet ${walletAddress} on Base?`);
}

/**
 * Transfer tokens from the platform treasury to a recipient.
 */
async function transferToken(toAddress, amount, token = 'USDC') {
  return execute(`Send ${amount} ${token} to ${toAddress} on Base`);
}

/**
 * Get current price of a token.
 */
async function getTokenPrice(symbol) {
  return execute(`What is the current price of ${symbol}?`);
}

/**
 * Request payment: instruct Bankr to transfer USDC from agent's wallet to treasury.
 * The agent must have already set up their Bankr wallet.
 */
async function requestPayment(amount, currency, description) {
  const treasury = process.env.TREASURY_WALLET;
  if (!treasury) throw new Error('TREASURY_WALLET not configured');
  return execute(`Send ${amount} ${currency} to ${treasury} on Base for: ${description}`);
}

/**
 * Check if Bankr API is configured and available.
 */
function isConfigured() {
  return Boolean(BANKR_KEY);
}

module.exports = {
  submitJob,
  pollJob,
  execute,
  checkBalance,
  transferToken,
  getTokenPrice,
  requestPayment,
  isConfigured,
};
