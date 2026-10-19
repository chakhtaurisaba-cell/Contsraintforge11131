// The final quality gate (server/services/qualityGate.js): deterministic rules for physical
// realism, exact tools, safety and clear instructions — applied to every idea, whatever the model says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSteps, isRenamedObject, tapeHoldsGlass, checkProduct, concreteSteps, vaguePlanSteps, toolsNotOwned, safetyNoteFor } from '../server/services/qualityGate.js';

const uses = (...names) => names.map((inventoryName) => ({ inventoryName }));

test('no cutting tool: a step that cuts makes the idea need scissors (never silently allowed)', () => {
  const r = checkSteps({ steps: ['Place the bottle upright on the table.', 'Cut around the bottle 10 cm from the bottom.', 'Tape over the cut edge.'] }, { userTools: [], primaryClass: 'plastic_bottle' });
  assert.deepEqual(r.toolsNeeded, ['Scissors']);
});

test('with scissors: the cut is allowed and the step names the user’s scissors; "cut edge" is not a cut', () => {
  const r = checkSteps({ steps: ['Place the bottle upright on the table.', 'Cut around the bottle 10 cm from the bottom.', 'Tape over the cut edge firmly.'] }, { userTools: ['Scissors'], primaryClass: 'plastic_bottle' });
  assert.deepEqual(r.toolsNeeded, []);
  assert.equal(r.steps[1], 'Cut around the bottle 10 cm from the bottom (use your scissors).');
  assert.equal(r.steps[2], 'Tape over the cut edge firmly.');
  const wood = checkSteps({ steps: ['Mark 300 mm on the board with a pencil.', 'Cut the board at the mark.', 'Sand the cut end smooth.'] }, { userTools: ['Scissors', 'Hand saw'], primaryClass: 'wood' });
  assert.match(wood.steps[1], /use your hand saw/, 'wood is cut with the saw, not the scissors');
});

test('every tool a step uses must be owned: drill, needle, hot glue; screws need a screwdriver, not a hammer', () => {
  const r = checkSteps({ steps: ['Drill two 5 mm holes in the board ends.', 'Sew the strap to the fabric with a needle.', 'Fix the corners with hot glue.'] }, { userTools: ['Hammer'], primaryClass: 'wood' });
  assert.deepEqual(r.toolsNeeded.sort(), ['Drill / driver', 'Hot-glue gun', 'Needle'].sort());
  const screws = checkSteps({ steps: ['Cut two 300 mm sides with the hand saw.', 'Join the sides with 4 screws each.', 'Sand all edges smooth.'] }, { userTools: ['Hammer', 'Hand saw'], primaryClass: 'wood' });
  assert.deepEqual(screws.toolsNeeded, ['Screwdriver']);
  const cap = checkSteps({ steps: ['Fill the bottle with cold water.', 'Screw the cap on tightly.', 'Wrap tape around the cap twice.'] }, { userTools: [], primaryClass: 'plastic_bottle' });
  assert.deepEqual(cap.toolsNeeded, [], 'screwing on a bottle cap needs no tool');
});

test('glass: cutting or drilling it is rejected; tying cord around it is fine', () => {
  for (const step of ['Drill a hole in the jar near the rim.', 'Cut the glass jar in half.', 'Score the bottle and break off the top.']) {
    const r = checkSteps({ steps: [step, 'Thread the lace through the opening.'] }, { userTools: ['Drill / driver', 'Glass cutter'], primaryClass: 'glass', usesGlass: true });
    assert.match(r.reject || '', /cut or drill glass/, step);
  }
  const ok = checkSteps({ steps: ['Tie the shoelace twice around the jar neck below the rim.', 'Knot both ends together 20 cm above the jar to make a loop.', 'Hang the jar from the loop and check it sits level.'] }, { userTools: [], primaryClass: 'glass', usesGlass: true });
  assert.equal(ok.reject, undefined);
  assert.deepEqual(ok.toolsNeeded, []);
});

test('vague guides are rejected; concrete ones are kept', () => {
  assert.match(checkSteps({ steps: ['Prepare the bottle.', 'Attach the tape.', 'Finish the organizer.'] }, {}).reject, /vague/);
  assert.match(checkSteps({ steps: ['Assemble the components.', 'Construct the base.', 'Attach securely.'] }, {}).reject, /vague/);
  assert.deepEqual(concreteSteps(['Prepare the materials.', 'Wrap tape three times around the bottle 5 cm below the neck.']), ['Wrap tape three times around the bottle 5 cm below the neck.']);
  assert.match(checkSteps({ steps: ['Look at the jar on the shelf.', 'Admire the jar in good light.'] }, {}).reject, /same object/, 'no physical action at all');
});

test('renamed objects are not projects: jar → vase, box → storage box, cup → pencil holder', () => {
  assert.equal(isRenamedObject({ name: 'Glass jar vase', usesExisting: uses('glass jar', 'shoelace') }), true);
  assert.equal(isRenamedObject({ name: 'Twine-wrapped jar vase', usesExisting: uses('glass jar', 'glue') }), true, 'decorating does not change what it is for');
  assert.equal(isRenamedObject({ name: 'Cardboard storage box', usesExisting: uses('cardboard boxes') }), true);
  assert.equal(isRenamedObject({ name: 'Cup pencil holder', usesExisting: uses('paper cup') }), true);
  assert.equal(isRenamedObject({ name: 'Bottle water container', usesExisting: uses('plastic bottle') }), true);
  // Real transformations and new functions pass.
  assert.equal(isRenamedObject({ name: 'Hanging jar holder', usesExisting: uses('glass jar', 'shoelace') }), false);
  assert.equal(isRenamedObject({ name: 'Bottle pencil holder', usesExisting: uses('plastic bottle', 'tape') }), false, 'a bottle has to be cut to become a pen holder');
  assert.equal(isRenamedObject({ name: 'Cardboard storage box', usesExisting: uses('cardboard sheet', 'tape') }), false, 'built from flat sheets');
  assert.equal(isRenamedObject({ name: 'Pine wall shelf', usesExisting: uses('pine boards', 'screws') }), false);
});

test('glass is never held up by tape; a cord can hold a light jar and then gets a safety note', () => {
  const taped = { name: 'Wall jar holder', usesExisting: uses('glass jar', 'tape'), steps: ['Stick the jar to the wall with three strips of tape.'] };
  assert.equal(tapeHoldsGlass(taped), true);
  assert.match(checkProduct(taped), /tape can’t safely hold up a glass/);
  const tied = { name: 'Hanging jar holder', usesExisting: uses('glass jar', 'shoelace'), steps: ['Tie the lace around the neck.', 'Hang it from the loop.'], safetyNote: '' };
  assert.equal(checkProduct(tied), null);
  assert.match(safetyNoteFor(tied), /hang it low/i);
});

test('build-plan checks: vague guide steps are found; tools the user lacks are named', () => {
  assert.deepEqual(vaguePlanSteps([{ instructions: 'Assemble the components.' }, { instructions: 'Place the bottle upright and mark a line 10 cm above the table all the way round.' }, { instructions: 'Attach securely.' }]), [1, 3]);
  assert.deepEqual(toolsNotOwned('Drill a 3 mm pilot hole, then drive the screw with the screwdriver.', ['Hammer']), ['Drill / driver', 'Screwdriver']);
  assert.deepEqual(toolsNotOwned('Cut along the line with the scissors.', ['Scissors']), []);
});
