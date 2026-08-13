require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Serves runtime config to the browser (so you don't hardcode secrets/IDs in HTML).
app.get('/config.js', (req, res) => {
  const config = {
    edgeConfigId: process.env.EDGE_CONFIG_ID || '',
    orgSandbox: process.env.ORG_SANDBOX || 'prod',
    decisionScope: process.env.DECISION_SCOPE || 'poc.returnPrompt.web',
    mockMode: (process.env.MOCK_MODE || 'true').toLowerCase() === 'true'
  };
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify(config, null, 2)};`);
});

// Simulates what AJO's code-based experience node would return.
// Lets you build/test the UI before the real journey + datastream are configured.
app.get('/api/mock-proposition', (req, res) => {
  res.json({
    propositions: [
      {
        id: 'mock-proposition-id',
        scope: `web://localhost:${PORT}/thank-you.html${process.env.DECISION_SCOPE || '#thankyou-return-prompt'}`,
        scopeDetails: {},
        items: [
          {
            id: 'mock-item-1',
            data: {
              content: {
                headline: 'Planning your return trip?',
                subheadline: 'Tell us when you\'re heading back and we\'ll get you sorted.',
                dateFieldLabel: 'Return date',
                purposeFieldLabel: 'What\'s this trip for?',
                purposeOptions: ['leisure', 'work'],
                ctaText: 'Save my return details'
                //,variant: 'A'
              }
            }
          }
        ]
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`\nAdobe POC web app running at http://localhost:${PORT}`);
  console.log(`Thank-you page:  http://localhost:${PORT}/thank-you.html\n`);
});
