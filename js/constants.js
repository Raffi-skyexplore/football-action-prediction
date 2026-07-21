const SKELETON = [
  [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]
];

const ACTION_COLORS = {
  shoot: '#ef4444', pass: '#3b82f6', dribble: '#22c55e',
  run: '#f59e0b', tackle: '#8b5cf6', stop: '#64748b'
};

const ACTION_KEYS = ['shoot', 'pass', 'dribble', 'run', 'tackle', 'stop'];
const ACTION_NAMES = { shoot: 'Shoot', pass: 'Pass', dribble: 'Dribble', run: 'Run', tackle: 'Tackle', stop: 'Stand' };

const LIMB_PAIRS = [
  { a: 5, b: 6, w: 1.0 }, { a: 5, b: 7, w: 0.55 }, { a: 7, b: 9, w: 0.4 },
  { a: 6, b: 8, w: 0.55 }, { a: 8, b: 10, w: 0.4 },
  { a: 11, b: 12, w: 0.8 }, { a: 11, b: 13, w: 0.65 }, { a: 13, b: 15, w: 0.45 },
  { a: 12, b: 14, w: 0.65 }, { a: 14, b: 16, w: 0.45 },
  { a: 5, b: 11, w: 0.9 }, { a: 6, b: 12, w: 0.9 },
  { a: 0, b: 5, w: 0.5 }, { a: 0, b: 6, w: 0.5 }
];

const LLM_CONFIGS = {
  gemini: { name: 'Gemini 2.0 Flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', apiModel: '', keyLabel: 'Google AI Studio API Key', isGemini: true },
  deepseek: { name: 'DeepSeek V4 Flash Free', endpoint: 'https://api.deepseek.com/v1/chat/completions', apiModel: 'deepseek-chat', keyLabel: 'DeepSeek API Key' },
  glm: { name: 'GLM-4.5', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', apiModel: 'glm-4', keyLabel: 'Zhipu API Key' }
};

const POSE_MODEL = { model: 'MoveNet', config: { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING } };
