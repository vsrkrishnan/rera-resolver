import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectDetails } from '../parseProjectDetails.js';

// Fixture reproduces the label/colon/value text-node sequence confirmed live
// against 3 real projectDetails responses during Phase 1.0 (exact tag names
// vary/are irrelevant — the parser only reads the flattened text-node
// sequence, which is what's verified).
const FIXTURE = `
<html><body>
<div class="tab-pane" id="menu2">
  <label>Project Type</label><span>:</span><span>Plotted Development</span>
  <label>Project Status</label><span>:</span><span>New Project Launch</span>
  <label>Project Start Date</label><span>:</span><span>01-05-2024</span>
  <label>Project End Date</label><span>:</span><span>31-12-2030</span>
</div>
<div class="tab-pane" id="menu-complaints">
  <h1>Complaints On this Promoter (0)</h1>
  <h1>Complaints On this Project (2)</h1>
</div>
</body></html>
`;

test('parseProjectDetails extracts status, dates, and complaint counts', () => {
  const parsed = parseProjectDetails(FIXTURE);
  assert.deepEqual(parsed, {
    projectStatus: 'New Project Launch',
    projectStartDate: '01-05-2024',
    projectEndDate: '31-12-2030',
    complaintsOnPromoter: 0,
    complaintsOnProject: 2,
  });
});

test('parseProjectDetails omits fields it cannot find rather than faking them', () => {
  const parsed = parseProjectDetails('<html><body>nothing relevant here</body></html>');
  assert.deepEqual(parsed, {
    projectStatus: undefined,
    projectStartDate: undefined,
    projectEndDate: undefined,
    complaintsOnPromoter: undefined,
    complaintsOnProject: undefined,
  });
});
