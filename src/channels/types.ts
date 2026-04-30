export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface ChannelConfig {
  name: string;
  analysesDir: string;
  sourcesDir: string;
  voiceDir: string;
  clipsDir: string;
  compositionsDir: string;
  runsDir: string;
  videosDir: string;
  notionDbId: string;
  narratorVoiceId: string;
  voiceSettings?: VoiceSettings;
  missionLine: string;
  scriptBlock: string;
  hookBlock: string;
  bodyBlock: string;
}
