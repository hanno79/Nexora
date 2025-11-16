// Linear integration helper - from linear blueprint
import { LinearClient } from '@linear/sdk';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=linear',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Linear not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
export async function getUncachableLinearClient() {
  const accessToken = await getAccessToken();
  return new LinearClient({ accessToken });
}

export async function exportToLinear(title: string, description: string): Promise<{ issueId: string; url: string }> {
  try {
    const linear = await getUncachableLinearClient();
    
    // Get the first team
    const teams = await linear.teams();
    const team = teams.nodes[0];
    
    if (!team) {
      throw new Error('No Linear team found');
    }

    // Create an issue
    const issue = await linear.createIssue({
      teamId: team.id,
      title,
      description,
    });

    const createdIssue = await issue.issue;
    if (!createdIssue) {
      throw new Error('Failed to create Linear issue');
    }

    return {
      issueId: createdIssue.id,
      url: createdIssue.url,
    };
  } catch (error: any) {
    console.error('Error exporting to Linear:', error);
    
    // Handle specific Linear error types
    if (error.type === 'UsageLimitExceeded' || error.message?.includes('usage limit exceeded')) {
      throw new Error('Linear workspace has reached the free issue limit. Please upgrade your Linear plan or contact sales@linear.app for a trial.');
    }
    
    if (error.message?.includes('authentication') || error.message?.includes('unauthorized')) {
      throw new Error('Linear authentication failed. Please reconnect your Linear account.');
    }
    
    if (error.message?.includes('team')) {
      throw new Error('No Linear team found. Please create a team in Linear first.');
    }
    
    // Generic error fallback
    throw new Error(`Failed to export to Linear: ${error.message || 'Unknown error'}`);
  }
}

export async function checkLinearConnection(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch (error) {
    return false;
  }
}

export async function getLinearIssue(issueIdentifier: string): Promise<any> {
  try {
    const linear = await getUncachableLinearClient();
    
    const issue = await linear.issue(issueIdentifier);
    
    if (!issue) {
      throw new Error(`Issue ${issueIdentifier} not found`);
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      state: await issue.state,
      priority: issue.priority,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  } catch (error: any) {
    console.error('Error fetching Linear issue:', error);
    throw new Error(`Failed to fetch Linear issue: ${error.message}`);
  }
}
