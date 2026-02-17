// Quick test of X API bearer token
const TOKEN = process.env.X_API_BEARER_TOKEN || 'AAAAAAAAAAAAAAAAAAAAAGiE7gEAAAAADrj%2Bd03W8%2B74VVQN1YWHLVD6oIw%3DynENNBX42754JGr4U3S88pOFtxCBMj6CCV5Dql2fP6erwTqCJw';

async function test() {
  console.log('Token length:', TOKEN.length);

  // Test 1: User lookup
  console.log('\n--- Test 1: User Lookup (@elonmusk) ---');
  const userRes = await fetch(
    'https://api.x.com/2/users/by/username/elonmusk?user.fields=description,profile_image_url,public_metrics,created_at',
    { headers: { 'Authorization': 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(15000) }
  );
  console.log('Status:', userRes.status);
  const userData = await userRes.json();
  console.log('Response:', JSON.stringify(userData, null, 2).slice(0, 800));

  if (userData.data) {
    // Test 2: Fetch tweets
    console.log('\n--- Test 2: User Tweets ---');
    const tweetsRes = await fetch(
      `https://api.x.com/2/users/${userData.data.id}/tweets?max_results=5&tweet.fields=created_at,public_metrics&exclude=retweets,replies`,
      { headers: { 'Authorization': 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(15000) }
    );
    console.log('Status:', tweetsRes.status);
    const tweetsData = await tweetsRes.json();
    console.log('Tweets:', JSON.stringify(tweetsData, null, 2).slice(0, 1000));
  }

  // Test 3: Personality analysis (using our analyzer)
  if (userData.data) {
    console.log('\n--- Test 3: Personality Analysis ---');
    const { analyzeTweets } = require('../src/sims/x-api/personalityAnalyzer');
    const { mapTraitsToSims } = require('../src/sims/x-api/traitMapper');

    const sampleTweets = ['Building the future of AI and space exploration!', 'The algorithm is everything', 'Free speech is essential'];
    const traits = analyzeTweets(sampleTweets);
    console.log('Traits:', traits);

    const simsAttrs = mapTraitsToSims(traits, userData.data);
    console.log('Sims attrs:', simsAttrs);
  }
}

test().catch(e => console.error('Error:', e.message));
