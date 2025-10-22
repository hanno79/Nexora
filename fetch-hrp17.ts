import { getLinearIssue } from './server/linearHelper.js';

async function main() {
  try {
    console.log('Fetching HRP-17 from Linear...\n');
    const issue = await getLinearIssue('HRP-17');
    console.log('='.repeat(80));
    console.log('TITLE:', issue.title);
    console.log('URL:', issue.url);
    console.log('PRIORITY:', issue.priority);
    console.log('='.repeat(80));
    console.log('\nDESCRIPTION:\n');
    console.log(issue.description);
    console.log('\n' + '='.repeat(80));
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
