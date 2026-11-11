import type { QuizQuestion, SlangLevel } from '../../contracts/types';

/**
 * Hand-written scripts for the sample deck, so the demo shows what the real
 * pipeline is meant to produce. Real decks go through the AI-analysis service.
 */
export interface DemoScript {
  hook: Record<SlangLevel, string>;
  body: Record<SlangLevel, string>;
  deeper: Record<SlangLevel, string>;
  keyTerms: string[];
  quiz: QuizQuestion[];
  summary: string;
}

export const DEMO_SCRIPTS: Record<number, DemoScript> = {
  0: {
    hook: {
      unhinged: 'POV: your cells are running a whole economy and you didn’t even know.',
      mild: 'Quick one: what is cellular respiration actually doing?',
      plain: 'Cellular respiration, in thirty seconds.',
    },
    body: {
      unhinged: 'Every cell takes glucose, breaks it down in four stages, and cashes it out as ATP. ATP is the currency. Glucose is the paycheck. The whole lecture is just following the money.',
      mild: 'Cells break glucose down in four stages and store the energy as ATP. ATP is the currency the cell spends. This lecture follows that energy step by step.',
      plain: 'Cells break down glucose in four stages and store the released energy as ATP, which the cell uses to do work.',
    },
    deeper: {
      unhinged: 'Still here? Fine. Four stages: glycolysis, pyruvate oxidation, Krebs, electron transport. Remember the order and you’ve basically got the lecture.',
      mild: 'The four stages in order: glycolysis, pyruvate oxidation, the Krebs cycle, and the electron transport chain.',
      plain: 'The four stages are glycolysis, pyruvate oxidation, the Krebs cycle and the electron transport chain.',
    },
    keyTerms: ['ATP', 'glucose'],
    quiz: [
      {
        question: 'What is the cell’s energy currency?',
        options: ['Glucose', 'ATP', 'Oxygen', 'Pyruvate'],
        answerIndex: 1,
        ifRight: 'W. ATP is the money.',
        ifWrong: 'That’s the paycheck, not the cash. ATP is the currency.',
      },
    ],
    summary: 'Cells break down glucose in four stages. The energy ends up stored as ATP.',
  },
  1: {
    hook: {
      unhinged: 'POV: one glucose walks in and leaves as thirty ATP.',
      mild: 'One glucose, about thirty ATP. Here’s the trick.',
      plain: 'Why the overall equation hides most of the story.',
    },
    body: {
      unhinged: 'The equation looks like one move: glucose plus oxygen, out comes CO2, water and energy. Lowkey a lie. The cell releases energy in tiny steps so it doesn’t just burn up. Up to thirty to thirty-two ATP per glucose. Slow and steady, bestie.',
      mild: 'The equation looks like one step, but the cell releases energy gradually so none of it is wasted as heat. The payoff is up to thirty to thirty-two ATP per glucose.',
      plain: 'Glucose and oxygen become carbon dioxide, water and energy. The cell releases this energy gradually, producing up to thirty to thirty-two ATP per glucose.',
    },
    deeper: {
      unhinged: 'Round two. If the cell dropped all that energy at once it’s basically a campfire. Small steps means it catches the energy as ATP instead.',
      mild: 'Releasing energy in small steps lets the cell capture it as ATP instead of losing it as heat.',
      plain: 'Gradual release lets the cell capture energy as ATP rather than losing it as heat.',
    },
    keyTerms: ['ATP'],
    quiz: [
      {
        question: 'Why does the cell release energy in small steps?',
        options: ['To use less oxygen', 'To capture it as ATP', 'To make more glucose', 'It doesn’t'],
        answerIndex: 1,
        ifRight: 'Ate. Small steps, more ATP caught.',
        ifWrong: 'Nah. All at once would waste it as heat. Small steps let it capture ATP.',
      },
    ],
    summary: 'The overall reaction happens in many small steps. That lets the cell capture up to 30–32 ATP per glucose.',
  },
  2: {
    hook: {
      unhinged: 'POV: you’re a glucose molecule and you just got split in half before even reaching the club.',
      mild: 'Glycolysis: the split before the party.',
      plain: 'Glycolysis is the first stage.',
    },
    body: {
      unhinged: 'That’s glycolysis, bestie. It happens in the cytoplasm, not the mitochondria. No oxygen needed. Six-carbon glucose gets split into two three-carbon pyruvates, and you walk away with two ATP and two NADH. Small bag, but it’s a start.',
      mild: 'Glycolysis splits glucose into two pyruvates. It happens in the cytoplasm, not the mitochondria, and it doesn’t need oxygen. Net gain: two ATP and two NADH.',
      plain: 'Glycolysis splits one glucose into two pyruvate molecules in the cytoplasm. It does not need oxygen and produces a net two ATP and two NADH.',
    },
    deeper: {
      unhinged: 'Again, slower. Where? Cytoplasm. Oxygen? Not needed. Profit? Two ATP, two NADH. That’s the whole slide, chief.',
      mild: 'Three things to keep: cytoplasm, no oxygen, two ATP plus two NADH.',
      plain: 'Location: cytoplasm. Oxygen: not required. Net yield: two ATP and two NADH.',
    },
    keyTerms: ['glycolysis', 'cytoplasm'],
    quiz: [
      {
        question: 'Bro got split before entering the mitochondria. Which step was that?',
        options: ['Krebs cycle', 'Glycolysis', 'Electron transport chain', 'Photosynthesis'],
        answerIndex: 1,
        ifRight: 'W. Glycolysis, in the cytoplasm. You ate.',
        ifWrong: 'Not that one, chief. The split happens first, in the cytoplasm. That’s glycolysis.',
      },
    ],
    summary: 'Glycolysis splits glucose into two pyruvate in the cytoplasm. It needs no oxygen and nets 2 ATP and 2 NADH.',
  },
  3: {
    hook: {
      unhinged: 'POV: pyruvate just got its VIP pass to the mitochondria.',
      mild: 'The bridge step nobody remembers.',
      plain: 'Pyruvate oxidation links the stages.',
    },
    body: {
      unhinged: 'Each pyruvate walks into the mitochondrion and gets turned into acetyl-CoA. It drops a CO2 at the door and picks up an NADH on the way in. This is the bridge between glycolysis and Krebs. Skip it and the exam will remember.',
      mild: 'Each pyruvate enters the mitochondrion and becomes acetyl-CoA, releasing one CO2 and making one NADH. It connects glycolysis to the Krebs cycle.',
      plain: 'Pyruvate enters the mitochondrion and is converted to acetyl-CoA, releasing CO2 and producing NADH. This links glycolysis to the Krebs cycle.',
    },
    deeper: {
      unhinged: 'One more time: pyruvate in, acetyl-CoA out, plus one CO2 and one NADH. Bridge step. Done.',
      mild: 'Pyruvate becomes acetyl-CoA, plus one CO2 and one NADH each.',
      plain: 'Each pyruvate yields one acetyl-CoA, one CO2 and one NADH.',
    },
    keyTerms: ['acetyl-CoA'],
    quiz: [
      {
        question: 'Pyruvate gets converted into what before Krebs?',
        options: ['Glucose', 'Lactic acid', 'Acetyl-CoA', 'ATP synthase'],
        answerIndex: 2,
        ifRight: 'Correct. Acetyl-CoA is the VIP pass.',
        ifWrong: 'Close, but no. Pyruvate becomes acetyl-CoA first.',
      },
    ],
    summary: 'In the mitochondrion each pyruvate becomes acetyl-CoA, releasing CO2 and making NADH.',
  },
  4: {
    hook: {
      unhinged: 'POV: the mitochondria pulls up, main character energy.',
      mild: 'The Krebs cycle, minus the panic.',
      plain: 'The Krebs cycle.',
    },
    body: {
      unhinged: 'Acetyl-CoA feeds the Krebs cycle in the matrix, and it farms like it’s grinding XP. Two turns per glucose. Out comes two ATP, six NADH and two FADH2. Plot twist: the real loot is the NADH, not the ATP. Save that for later.',
      mild: 'Acetyl-CoA enters the Krebs cycle in the mitochondrial matrix. Two turns per glucose produce two ATP, six NADH and two FADH2. Most of the energy is now held in NADH and FADH2.',
      plain: 'In the mitochondrial matrix, acetyl-CoA enters the Krebs cycle. Two turns per glucose produce two ATP, six NADH and two FADH2, and release the remaining carbon as CO2.',
    },
    deeper: {
      unhinged: 'Deeper cut. Where? Matrix. How many turns? Two. Biggest output? NADH. That NADH is about to pay off big in the next stage.',
      mild: 'Remember: matrix, two turns, and the energy is mostly stored in NADH and FADH2.',
      plain: 'The cycle runs twice per glucose in the matrix and stores most energy in NADH and FADH2.',
    },
    keyTerms: ['Krebs cycle', 'matrix'],
    quiz: [
      {
        question: 'Where does the Krebs cycle happen?',
        options: ['Cytoplasm', 'Mitochondrial matrix', 'Cell membrane', 'Nucleus'],
        answerIndex: 1,
        ifRight: 'Matrix. Main character location. W.',
        ifWrong: 'Not quite, chief. It’s inside the mitochondrion, in the matrix.',
      },
    ],
    summary: 'The Krebs cycle runs in the mitochondrial matrix, twice per glucose, producing 2 ATP, 6 NADH and 2 FADH2.',
  },
  5: {
    hook: {
      unhinged: 'POV: NADH finally cashes the cheque.',
      mild: 'Where the electrons go.',
      plain: 'The electron transport chain.',
    },
    body: {
      unhinged: 'NADH and FADH2 hand their electrons to the electron transport chain on the inner membrane. Electrons slide down a line of proteins like a water slide, and every step pumps H plus ions across. At the bottom, oxygen catches the electrons and becomes water. No oxygen, no party.',
      mild: 'NADH and FADH2 pass electrons to a chain of proteins on the inner membrane. As electrons move, H+ ions are pumped across. Oxygen accepts the electrons at the end and forms water.',
      plain: 'Electrons from NADH and FADH2 pass along proteins in the inner membrane, pumping H+ ions across it. Oxygen is the final electron acceptor and forms water.',
    },
    deeper: {
      unhinged: 'Okay, why do we breathe? This. Oxygen sits at the end of the chain catching electrons. Remove it and the whole line jams.',
      mild: 'Oxygen is needed because it is the final electron acceptor. Without it the chain stops.',
      plain: 'Without oxygen as the final acceptor, electron transport stops.',
    },
    keyTerms: ['electron transport chain', 'oxygen'],
    quiz: [
      {
        question: 'Who catches the electrons at the end of the chain?',
        options: ['Glucose', 'Carbon dioxide', 'Oxygen', 'ATP'],
        answerIndex: 2,
        ifRight: 'Oxygen. That’s literally why you breathe. W.',
        ifWrong: 'Nope. Oxygen is the final acceptor, and it becomes water.',
      },
    ],
    summary: 'Electrons from NADH and FADH2 move along the inner membrane, pumping H+ ions. Oxygen accepts them and forms water.',
  },
  6: {
    hook: {
      unhinged: 'POV: a tiny turbine is printing your energy.',
      mild: 'ATP synthase is a literal turbine.',
      plain: 'How ATP synthase makes ATP.',
    },
    body: {
      unhinged: 'All those H plus ions pumped across? They rush back through ATP synthase, and it spins like a turbine. Every spin makes ATP. This is chemiosmosis, and it makes around twenty-six to twenty-eight ATP per glucose. The biggest payout of the whole lecture.',
      mild: 'H+ ions flow back through ATP synthase, which spins like a turbine and makes ATP. This is chemiosmosis, producing about twenty-six to twenty-eight ATP per glucose.',
      plain: 'H+ ions flow back through ATP synthase, which rotates and produces ATP. This process, chemiosmosis, makes about 26 to 28 ATP per glucose.',
    },
    deeper: {
      unhinged: 'Last try: pump ions out, let them flow back through the turbine, turbine makes ATP. That’s chemiosmosis.',
      mild: 'Ions pumped out, ions flow back through ATP synthase, ATP made. That’s chemiosmosis.',
      plain: 'The H+ gradient drives ATP synthase. This is chemiosmosis.',
    },
    keyTerms: ['ATP synthase', 'chemiosmosis'],
    quiz: [
      {
        question: 'What spins to make most of the ATP?',
        options: ['Ribosome', 'ATP synthase', 'Glycolysis', 'NADH'],
        answerIndex: 1,
        ifRight: 'Turbine gang. W.',
        ifWrong: 'That’s not the turbine. ATP synthase spins as H+ flows back.',
      },
    ],
    summary: 'H+ ions flow back through ATP synthase, which spins and makes about 26–28 ATP per glucose.',
  },
  7: {
    hook: {
      unhinged: 'POV: the whole lecture in one breath.',
      mild: 'The recap you’ll need on exam day.',
      plain: 'Summary of the four stages.',
    },
    body: {
      unhinged: 'Glycolysis in the cytoplasm, two ATP. Pyruvate oxidation, the bridge. Krebs in the matrix, two ATP and loads of NADH. Then electron transport and ATP synthase on the inner membrane cash out around twenty-six to twenty-eight. Locked in.',
      mild: 'Glycolysis in the cytoplasm makes two ATP. Pyruvate oxidation links to Krebs. Krebs in the matrix makes two ATP and lots of NADH. The electron transport chain and ATP synthase make the rest.',
      plain: 'Glycolysis, pyruvate oxidation, the Krebs cycle and the electron transport chain together convert glucose into ATP, with most ATP made at the inner membrane.',
    },
    deeper: {
      unhinged: 'Order check: glycolysis, bridge, Krebs, chain. Where is most ATP made? Inner membrane. Lock it in.',
      mild: 'Most ATP comes from the last stage, on the inner membrane.',
      plain: 'Most ATP is produced at the inner mitochondrial membrane.',
    },
    keyTerms: ['inner membrane'],
    quiz: [
      {
        question: 'Which stage makes the most ATP?',
        options: ['Glycolysis', 'Krebs cycle', 'Electron transport + ATP synthase', 'Pyruvate oxidation'],
        answerIndex: 2,
        ifRight: 'Yep. The last stage is where the bag is.',
        ifWrong: 'Not that one. Electron transport and ATP synthase make about 26–28.',
      },
    ],
    summary: 'Four stages turn glucose into ATP. Most ATP comes from electron transport and ATP synthase.',
  },
};
