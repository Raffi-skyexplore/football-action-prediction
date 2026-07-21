const PLAYER_TIPS = {
  shoot: [
    { min: 0, max: 30, icon: '🦵', text: 'Lift your <span class="highlight">kicking leg</span> much higher — drive the knee up' },
    { min: 30, max: 60, icon: '⚖️', text: 'Extend your <span class="highlight">opposite arm</span> wider for balance' },
    { min: 60, max: 80, icon: '🦶', text: 'Point your toe and <span class="highlight">lock your ankle</span> for a clean strike' },
    { min: 80, max: 101, icon: '💥', text: 'Excellent shooting form! Follow through toward the target' }
  ],
  pass: [
    { min: 0, max: 30, icon: '🙌', text: 'Push both <span class="highlight">arms forward</span> — extend through the elbows' },
    { min: 30, max: 60, icon: '🔄', text: 'Rotate your <span class="highlight">shoulders square</span> to the target' },
    { min: 60, max: 80, icon: '🎯', text: 'Good arm shape — <span class="highlight">lead with your wrists</span> for accuracy' },
    { min: 80, max: 101, icon: '✅', text: 'Perfect passing stance! Weight on your front foot' }
  ],
  dribble: [
    { min: 0, max: 30, icon: '⬇️', text: '<span class="highlight">Lower your center</span> of gravity — bend knees much more' },
    { min: 30, max: 60, icon: '🙆', text: 'Keep the <span class="highlight">ball close</span> — arms relaxed at your sides' },
    { min: 60, max: 80, icon: '👀', text: 'Great crouch! Keep your <span class="highlight">head up</span> to scan the field' },
    { min: 80, max: 101, icon: '⚡', text: 'Excellent dribble posture! Ready to change direction' }
  ],
  run: [
    { min: 0, max: 30, icon: '🏃', text: '<span class="highlight">Lean forward</span> from your ankles — pump your arms' },
    { min: 30, max: 60, icon: '💪', text: 'Drive your <span class="highlight">elbows back</span> — opposite arm to leg' },
    { min: 60, max: 80, icon: '🦵', text: 'Good rhythm! Increase <span class="highlight">knee drive</span> for more power' },
    { min: 80, max: 101, icon: '🚀', text: 'Sprinting form looks sharp! Light on your feet' }
  ],
  tackle: [
    { min: 0, max: 30, icon: '⬇️', text: '<span class="highlight">Drop your hips</span> low — you need to be much lower' },
    { min: 30, max: 60, icon: '🦵', text: 'Extend your <span class="highlight">leading leg</span> further — win the ball' },
    { min: 60, max: 80, icon: '🛡️', text: 'Good reach! <span class="highlight">Keep your body side-on</span> to protect' },
    { min: 80, max: 101, icon: '💪', text: 'Textbook tackle! Strong and low — ball is yours' }
  ],
  stop: [
    { min: 0, max: 30, icon: '🧘', text: 'Stand in a relaxed <span class="highlight">athletic stance</span> — ready to move' },
    { min: 30, max: 60, icon: '👀', text: 'Stay on the <span class="highlight">balls of your feet</span> — scan the pitch' },
    { min: 60, max: 80, icon: '🔄', text: 'Good awareness! <span class="highlight">Check your shoulder</span> for pressure' },
    { min: 80, max: 101, icon: '🌟', text: 'Perfect ready position — you cover the space well' }
  ]
};

const COACH_TIPS = {
  shoot: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Knee up, toe down"</span> — focus on leg drive' },
    { min: 30, max: 60, icon: '👀', text: 'Observe <span class="highlight">arm opposition</span> — remind them to extend for balance' },
    { min: 60, max: 80, icon: '🔍', text: 'Watch the <span class="highlight">ankle lock</span> — this separates good from great' },
    { min: 80, max: 101, icon: '✅', text: 'Technique looks solid. Now work on <span class="highlight">decision-making</span> under pressure' }
  ],
  pass: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Push through, don\'t poke"</span> — full arm extension' },
    { min: 30, max: 60, icon: '👀', text: 'Check <span class="highlight">shoulder alignment</span> — square to target = accuracy' },
    { min: 60, max: 80, icon: '🔍', text: 'Good foundation. Introduce <span class="highlight">weight transfer</span> drills next' },
    { min: 80, max: 101, icon: '✅', text: 'Passing form is repeatable. Progress to <span class="highlight">moving targets</span>' }
  ],
  dribble: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Sit down, stay low"</span> — bend is not low enough' },
    { min: 30, max: 60, icon: '👀', text: 'Tell them to <span class="highlight">scan the field</span> while keeping low posture' },
    { min: 60, max: 80, icon: '🔍', text: 'Good crouch. Next: <span class="highlight">change of pace</span> while maintaining form' },
    { min: 80, max: 101, icon: '✅', text: 'Posture is pro-level. Introduce <span class="highlight">defender shadow</span> drills' }
  ],
  run: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Lean and drive"</span> — forward lean needs work' },
    { min: 30, max: 60, icon: '👀', text: 'Watch the <span class="highlight">arm-leg coordination</span> — opposite arm drive' },
    { min: 60, max: 80, icon: '🔍', text: 'Good rhythm. Drill: <span class="highlight">high-knee runs</span> to increase power' },
    { min: 80, max: 101, icon: '✅', text: 'Efficient sprint mechanics. Add <span class="highlight">resistance training</span> next phase' }
  ],
  tackle: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Get low, get big"</span> — hips need to drop much more' },
    { min: 30, max: 60, icon: '👀', text: 'Check <span class="highlight">lead leg extension</span> — they need more reach' },
    { min: 60, max: 80, icon: '🔍', text: 'Good body shape. Drill <span class="highlight">side-on tackling</span> with a partner' },
    { min: 80, max: 101, icon: '✅', text: 'Tackle technique is sound. Practice <span class="highlight">live 1v1</span> scenarios' }
  ],
  stop: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Athletic stance"</span> — feet shoulder-width, knees bent' },
    { min: 30, max: 60, icon: '👀', text: 'Tell them to stay <span class="highlight">on the balls of their feet</span>, not flat' },
    { min: 60, max: 80, icon: '🔍', text: 'Good base. Now teach <span class="highlight">scanning habits</span> — left, right, behind' },
    { min: 80, max: 101, icon: '✅', text: 'Player reads the pitch well. Work on <span class="highlight">first touch</span> from this stance' }
  ]
};

const COACH_TRANSITION = {
  shoot_pass: 'After the shot, coach: <span class="highlight">"Land and find your next target"</span>',
  shoot_dribble: 'Teach: <span class="highlight">follow the shot</span> — prepare for rebound scenarios',
  pass_shoot: 'Progression: <span class="highlight">pass and move</span> — create space for a return',
  pass_dribble: 'Next drill: <span class="highlight">disguise the pass</span>, then dribble away',
  dribble_shoot: 'Cue from dribble: <span class="highlight">"Set your feet, then strike"</span>',
  dribble_pass: 'Coach point: <span class="highlight">lift the head</span> before releasing the pass',
  run_shoot: 'Drill: <span class="highlight">sprint → short stride → shoot</span> in one motion',
  run_tackle: 'Cue: <span class="highlight">"Drop the hips"</span> when transitioning from run to tackle'
};

const TRANSITION_TIPS = {
  shoot_pass: 'After the shot, <span class="highlight">land balanced</span> and scan for your next pass',
  shoot_dribble: 'Follow your shot and prepare to <span class="highlight">dribble</span> if it rebounds',
  pass_shoot: 'After passing, <span class="highlight">move into space</span> for a return pass or shot',
  pass_dribble: 'After passing, <span class="highlight">disguise your next move</span> — dribble or run',
  dribble_shoot: 'From dribble, <span class="highlight">set your feet</span> quickly and shoot',
  dribble_pass: 'From dribble, <span class="highlight">lift your head</span> and pick out the pass',
  run_shoot: 'From a run, <span class="highlight">shorten your stride</span> to set up the shot',
  run_tackle: '<span class="highlight">Lower your center</span> of gravity to transition into a tackle'
};

function getTipsForRole(role) {
  return role === 'coach' ? COACH_TIPS : PLAYER_TIPS;
}

function getTransForRole(role) {
  return role === 'coach' ? COACH_TRANSITION : TRANSITION_TIPS;
}
