import type { Deck } from '../contracts/types';

/**
 * Built-in sample deck so the desk opens in a working state.
 * Text format for demo slides: first paragraph = lead, lines starting "- " = bullets.
 * Words wrapped in ==double equals== render as highlighted key terms.
 */
export const DEMO_DECK: Deck = {
  id: 'demo-cellular-respiration',
  title: 'Cellular respiration',
  sourceType: 'demo',
  slideCount: 8,
  slides: [
    {
      index: 0,
      title: 'Cellular respiration',
      text: 'BIO 110 · Lecture 9\nHow cells turn glucose into usable energy.',
      notes: 'Title slide.',
      difficulty: 0.1,
    },
    {
      index: 1,
      title: 'The big picture',
      text: 'One glucose molecule is broken down step by step to make ==ATP==, the cell’s energy currency.\n- C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + energy\n- Energy is released gradually, not all at once\n- Up to ~30–32 ATP per glucose in eukaryotes',
      notes: 'Emphasise that the overall equation hides many small steps.',
      difficulty: 0.3,
    },
    {
      index: 2,
      title: 'Stage 1 · Glycolysis',
      text: '==Glycolysis== splits one glucose (6 carbons) into two pyruvate (3 carbons each).\n- Happens in the ==cytoplasm==\n- Does not need oxygen\n- Net gain: 2 ATP and 2 NADH',
      notes: 'Students often place glycolysis inside the mitochondria. It is not.',
      difficulty: 0.45,
    },
    {
      index: 3,
      title: 'Stage 2 · Pyruvate oxidation',
      text: 'Each pyruvate enters the mitochondrion and is converted to ==acetyl-CoA==.\n- Releases one CO₂ per pyruvate\n- Produces one NADH per pyruvate\n- Links glycolysis to the Krebs cycle',
      difficulty: 0.5,
    },
    {
      index: 4,
      title: 'Stage 3 · The Krebs cycle',
      text: 'Acetyl-CoA feeds the ==Krebs cycle== (citric acid cycle) in the mitochondrial ==matrix==.\n- Two turns per glucose\n- Yields 2 ATP, 6 NADH, 2 FADH₂\n- Releases the remaining carbon as CO₂',
      notes: 'Most of the energy is now stored in NADH and FADH₂, not ATP.',
      difficulty: 0.7,
    },
    {
      index: 5,
      title: 'Stage 4 · Electron transport chain',
      text: 'NADH and FADH₂ hand electrons to the ==electron transport chain== on the inner membrane.\n- Electrons flow down a chain of proteins\n- Pumps H⁺ ions into the intermembrane space\n- ==Oxygen== is the final electron acceptor, forming water',
      difficulty: 0.8,
    },
    {
      index: 6,
      title: 'ATP synthase',
      text: 'H⁺ ions flow back through ==ATP synthase==, which spins like a turbine to make ATP.\n- This is called chemiosmosis\n- Produces ~26–28 ATP per glucose\n- The biggest payoff of the whole process',
      difficulty: 0.75,
    },
    {
      index: 7,
      title: 'Summary',
      text: 'Four stages, one goal: move energy from glucose into ATP.\n- Glycolysis · cytoplasm · 2 ATP\n- Pyruvate oxidation · mitochondrion\n- Krebs cycle · matrix · 2 ATP\n- Electron transport + ATP synthase · inner membrane · ~26–28 ATP',
      difficulty: 0.4,
    },
  ],
};

/** Strip ==markers== for plain text uses (LLM input, TTS). */
export function plainText(text: string): string {
  return text.replace(/==(.+?)==/g, '$1');
}

export function keyTermsOf(text: string): string[] {
  return [...text.matchAll(/==(.+?)==/g)].map((m) => m[1]);
}
