#!/usr/bin/env node
// Show setup hint after npm install — writes to stderr so npm doesn't suppress it
process.stderr.write('\n\x1b[33m⚡ AgentToll installed!\x1b[0m Run \x1b[1mnpx agenttoll init\x1b[0m to set up your API key.\n\n');
