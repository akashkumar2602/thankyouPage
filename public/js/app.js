/* ---------------------------------------------------------
   Adobe POC — Thank-you page logic
   Flow: fire purchase event -> (reload) -> fetch decision
         -> render form -> fire travelIntent.captured event
--------------------------------------------------------- */

const ORDER_ID = 'ORD-POC-0001';
const cfg = window.APP_CONFIG || {};

const logEl = document.getElementById('log');
const mockBadge = document.getElementById('mockBadge');
const fireBtn = document.getElementById('fireEventBtn');
const fetchBtn = document.getElementById('fetchPropositionBtn');
const slot = document.getElementById('personalizationSlot');

mockBadge.textContent = cfg.mockMode ? 'MOCK MODE' : 'LIVE AEP';
mockBadge.style.background = cfg.mockMode ? '#fbbf24' : '#22c55e';

function log(label, payload) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${label}\n${payload ? JSON.stringify(payload, null, 2) + '\n' : ''}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// Track a simple flag in sessionStorage so we know whether the "purchase"
// step has already happened in this browser tab (simulates the reload step).
function purchaseAlreadyFired() {
  return sessionStorage.getItem('poc_purchase_fired') === '1';
}

// ---- Step 0: configure Alloy (only needed in LIVE mode) ----
async function configureAlloy() {
  if (cfg.mockMode) {
    log('Alloy configure skipped (mock mode)');
    return;
  }
  if (!cfg.edgeConfigId || cfg.edgeConfigId.includes('REPLACE')) {
    log('WARNING: EDGE_CONFIG_ID not set in .env — falling back to mock behavior for this call.');
    return;
  }
  await window.alloy('configure', {
    edgeConfigId: cfg.edgeConfigId,
    orgId: "2ACF35355F50F9060A495CFB@AdobeOrg", // orgId is embedded in the datastream; not required if using edgeConfigId
  });
  log('Alloy configured', { edgeConfigId: cfg.edgeConfigId });
}

// ---- Step 1: fire the purchase event ----
async function firePurchaseEvent() {
  const xdm = {
    eventType: 'commerce.purchases',
    commerce: { purchases: { value: 1 } },
    _belgiantrain: {
      ticket: {
        orderId: ORDER_ID,
        type: 'one-way',
        origin: 'Mechelen',
        destination: 'Brussels Airport',
        journeyDate: new Date().toISOString()
      }
    }
  };

  log('Firing purchase event (XDM payload)', xdm);

  if (cfg.mockMode || !cfg.edgeConfigId || cfg.edgeConfigId.includes('REPLACE')) {
    log('Mock mode: purchase event NOT actually sent to AEP Edge (no real datastream configured).');
  } else {
    try {
      const result = await window.alloy('sendEvent', { xdm });
      log('Purchase event sent to AEP Edge. Response:', result);
    } catch (err) {
      log('ERROR sending purchase event', { message: err.message });
    }
  }

  sessionStorage.setItem('poc_purchase_fired', '1');
  fireBtn.disabled = true;
  fetchBtn.disabled = false;
  log('Purchase step complete. Now click "Reload & fetch decision" (or actually reload the page) to simulate the journey having evaluated.');
}

// ---- Step 2: fetch the proposition (decision scope) ----
async function fetchProposition() {
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching…';

  let proposition = null;

  if (cfg.mockMode) {
    log('Fetching MOCK proposition from local server (/api/mock-proposition)');
    const res = await fetch('/api/mock-proposition');
    const data = await res.json();
    proposition = data.propositions.find(p => p.scope === cfg.decisionScope) || data.propositions[0];
  } else {
    try {
      // IMPORTANT: AJO code-based experiences use the "surfaces" personalization
      // API, not "decisionScopes" (decisionScopes is the legacy Adobe Target /
      // Decision Management API and will always return an empty array here).
      // cfg.decisionScope should be just the location fragment, e.g. "#thankyou-return-prompt".
      // Alloy automatically composes the full surface URI as web://<current-host><current-path>#<location>.
      const result = await window.alloy('sendEvent', {
        renderDecisions: true,
        personalization: {
          surfaces: [
            "web://localhost:4003/thank-you.html",
            "web://localhost:4003/thank-you.html#thankyou-return-prompt",
            "#thankyou-return-prompt"
          ]
        }
      });
      log('Proposition fetch response from AEP Edge', result);
      proposition = (result.propositions || [])[0]; // first (and only) surface we asked for
    } catch (err) {
      log('ERROR fetching proposition', { message: err.message });
    }
  }

  if (!proposition) {
    log('No proposition returned — user may not qualify yet, journey may not be published, or scope name mismatch.');
    fetchBtn.textContent = 'No proposition — retry';
    fetchBtn.disabled = false;
    return;
  }

  log('Proposition received', proposition);
  renderForm(proposition);
  fetchBtn.textContent = 'Fetched ✓';
}

// ---- Step 3: render the form using the proposition's content JSON ----
function renderForm(proposition) {
  const rawContent = proposition.items[0].data.content;
  // json-content-item propositions sometimes come back as a JSON string
  // rather than a pre-parsed object, depending on how the schema was set up.
  const content = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
  let selectedPurpose = null;

  slot.hidden = false;
  slot.innerHTML = `
    <h2>${content.headline}</h2>
    <p class="sub">${content.subheadline}</p>
    <div class="field">
      <label for="returnDate">${content.dateFieldLabel}</label>
      <input type="date" id="returnDate" min="${new Date().toISOString().split('T')[0]}" />
    </div>
    <div class="field">
      <label>${content.purposeFieldLabel}</label>
      <div class="purpose-toggle">
        ${content.purposeOptions.map(opt =>
          `<button type="button" data-purpose="${opt}">${opt[0].toUpperCase() + opt.slice(1)}</button>`
        ).join('')}
      </div>
    </div>
    <button class="submit-form-btn" id="submitFormBtn" disabled>${content.ctaText}</button>
  `;

  // impression tracking — required by AJO for the journey's engagement reporting.
  // Skipped automatically in mock mode since there's no real proposition id/scope.
  if (!cfg.mockMode) {
    sendPropositionDisplay(proposition);
  } else {
    log('Mock mode: skipping propositionDisplay event (no real proposition id/scope to track).');
  }

  const purposeButtons = slot.querySelectorAll('.purpose-toggle button');
  const dateInput = slot.querySelector('#returnDate');
  const submitBtn = slot.querySelector('#submitFormBtn');

  function refreshSubmitState() {
    submitBtn.disabled = !(dateInput.value && selectedPurpose);
  }

  purposeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      purposeButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPurpose = btn.dataset.purpose;
      refreshSubmitState();
    });
  });
  dateInput.addEventListener('change', refreshSubmitState);

  submitBtn.addEventListener('click', () => submitTravelIntent(dateInput.value, selectedPurpose, proposition));
}

// ---- Tracking: required manual events for AJO code-based experience reporting ----
function sendPropositionDisplay(proposition) {
  const { id, scope, scopeDetails = {} } = proposition;
  window.alloy('sendEvent', {
    xdm: {
      eventType: 'decisioning.propositionDisplay',
      _experience: {
        decisioning: {
          propositions: [{ id, scope, scopeDetails }]
        }
      }
    }
  }).then(() => log('Sent decisioning.propositionDisplay'))
    .catch(err => log('ERROR sending propositionDisplay', { message: err.message }));
}

function sendPropositionInteract(proposition, label) {
  const { id, scope, scopeDetails = {} } = proposition;
  window.alloy('sendEvent', {
    xdm: {
      eventType: 'decisioning.propositionInteract',
      _experience: {
        decisioning: {
          propositions: [{ id, scope, scopeDetails }],
          propositionEventType: { interact: 1 },
          propositionAction: { id: label, label: label }
        }
      }
    }
  }).then(() => log('Sent decisioning.propositionInteract'))
    .catch(err => log('ERROR sending propositionInteract', { message: err.message }));
}

// ---- Step 4: send the captured response back to AEP ----
async function submitTravelIntent(returnDate, travelPurpose, proposition) {
  const xdm = {
    eventType: 'travelIntent.captured',
    _belgiantrain: {
      travelIntent: {
        orderId: ORDER_ID,
        returnDate,
        travelPurpose
      }
    }
  };

  log('Firing travelIntent.captured event', xdm);

  if (cfg.mockMode || !cfg.edgeConfigId || cfg.edgeConfigId.includes('REPLACE')) {
    log('Mock mode: travelIntent event NOT actually sent to AEP Edge.');
  } else {
    try {
      const result = await window.alloy('sendEvent', { xdm });
      log('travelIntent.captured sent. Response:', result);
      sendPropositionInteract(proposition, 'submit_return_details');
    } catch (err) {
      log('ERROR sending travelIntent event', { message: err.message });
    }
  }

  slot.innerHTML = `<h2>Thanks — we'll be in touch!</h2><p class="sub">Return date and travel purpose saved to your profile.</p>`;
}

// ---- wire up buttons ----
fireBtn.addEventListener('click', firePurchaseEvent);
fetchBtn.addEventListener('click', fetchProposition);

// on load
(async function init() {
  document.getElementById('journeyDate').textContent = new Date().toLocaleString();
  await configureAlloy();
  if (purchaseAlreadyFired()) {
    log('Detected this is a reload — purchase event was already fired in this session.');
    fireBtn.disabled = true;
    fetchBtn.disabled = false;

    // This is the actual "reload triggers the decision fetch" behavior.
    // Previously this only unlocked the button and waited for a manual click,
    // which is why the interact call only appeared after clicking it.
    log('Auto-fetching proposition because this is a reload (not a manual click)...');
    fetchProposition();
  }
})();
