import { Resend } from 'resend';
import type { BeatScoreResult } from './beatScore';
import type { SuggestedStructure } from './structure';

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}

export type BriefEmailPayload = {
  ticker: string;
  earningsDate: string;
  spot: number;
  ivRank: number;
  expectedMovePct: number;
  expectedMoveDollar: number;
  score: BeatScoreResult;
  structure: SuggestedStructure;
  briefId: string;
  baseUrl: string;
};

export async function sendBriefEmail(payload: BriefEmailPayload) {
  const { ticker, earningsDate, score, structure } = payload;

  const signalColor = {
    SKIP: '#6b7280',
    SMALL_SPREAD: '#eab308',
    DIRECTIONAL: '#10b981',
    HIGH_CONVICTION: '#22c55e',
  }[score.signal];

  const html = `
<div style="font-family: ui-monospace, SFMono-Regular, monospace; max-width: 640px; margin: 0 auto; padding: 32px; background: #0a0a0a; color: #e5e5e5;">
  <div style="border-left: 3px solid ${signalColor}; padding-left: 16px; margin-bottom: 32px;">
    <div style="color: #737373; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;">Earnings Edge · ${earningsDate}</div>
    <h1 style="font-size: 32px; font-weight: 600; margin: 8px 0; color: #fafafa;">${ticker}</h1>
    <div style="color: ${signalColor}; font-size: 14px; font-weight: 600; letter-spacing: 0.05em;">
      ${score.signal} · SCORE ${score.composite}
    </div>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <tr>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626; font-size: 11px; color: #737373;">SPOT</td>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626;">$${payload.spot.toFixed(2)}</td>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626; font-size: 11px; color: #737373;">IV RANK</td>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626;">${payload.ivRank}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626; font-size: 11px; color: #737373;">EXPECTED</td>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626;">±$${payload.expectedMoveDollar.toFixed(2)} (${payload.expectedMovePct.toFixed(1)}%)</td>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626; font-size: 11px; color: #737373;">DATE</td>
      <td style="padding: 8px 12px; background: #171717; border: 1px solid #262626;">${earningsDate}</td>
    </tr>
  </table>

  <div style="margin-bottom: 24px;">
    <div style="color: #737373; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">Score Breakdown</div>
    ${renderComponentBars(score.components)}
  </div>

  ${score.reasoning.length ? `
  <div style="margin-bottom: 24px;">
    <div style="color: #737373; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">Signals</div>
    <ul style="margin: 0; padding-left: 20px; color: #d4d4d4; font-size: 13px;">
      ${score.reasoning.map(r => `<li style="margin-bottom: 4px;">${r}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <div style="background: #171717; border: 1px solid #262626; padding: 16px; margin-bottom: 24px;">
    <div style="color: #737373; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">Suggested Structure</div>
    <div style="color: #fafafa; font-size: 16px; font-weight: 600; margin-bottom: 8px;">${structure.action.replace(/_/g, ' ')}</div>
    <div style="color: #a3a3a3; font-size: 13px; margin-bottom: 12px;">${structure.rationale}</div>
    ${structure.legs ? `
      <div style="margin-bottom: 12px;">
        ${structure.legs.map(leg => `
          <div style="font-size: 13px; color: #d4d4d4;">
            <span style="color: ${leg.side === 'BUY' ? '#22c55e' : '#ef4444'}; font-weight: 600;">${leg.side}</span>
            ${leg.type} $${leg.strike} ${leg.expiry}
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${structure.notes.length ? `
      <ul style="margin: 0; padding-left: 16px; color: #737373; font-size: 12px;">
        ${structure.notes.map(n => `<li>${n}</li>`).join('')}
      </ul>
    ` : ''}
  </div>

  <a href="${payload.baseUrl}/briefs/${payload.briefId}" style="display: inline-block; background: #fafafa; color: #0a0a0a; padding: 10px 20px; text-decoration: none; font-size: 13px; font-weight: 600; letter-spacing: 0.05em;">VIEW FULL BRIEF →</a>

  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #262626; color: #525252; font-size: 11px;">
    Not financial advice. Sizing is yours. Score is decision support, not a trading bot.
  </div>
</div>
`;

  return getResend().emails.send({
    from: 'Earnings Edge <noreply@earnings-edge.app>',
    to: process.env.NOTIFY_EMAIL!,
    subject: `[${score.signal}] ${ticker} · Score ${score.composite} · ${earningsDate}`,
    html,
  });
}

function renderComponentBars(components: BeatScoreResult['components']) {
  const labels: Record<string, string> = {
    beatStreakScore: 'Beat streak',
    surpriseMagnitudeScore: 'Surprise mag',
    revisionTrendScore: 'Revisions',
    whisperDeltaScore: 'Whisper Δ',
    ivRankScore: 'IV (inv)',
    sectorMomentumScore: 'Sector',
    insiderScore: 'Insider',
  };

  return Object.entries(components)
    .map(([key, value]) => {
      const label = labels[key] || key;
      const color = value >= 65 ? '#22c55e' : value >= 40 ? '#eab308' : '#ef4444';
      return `
        <div style="display: flex; align-items: center; margin-bottom: 6px;">
          <div style="width: 100px; font-size: 11px; color: #a3a3a3;">${label}</div>
          <div style="flex: 1; background: #262626; height: 6px; margin-right: 8px;">
            <div style="background: ${color}; height: 100%; width: ${value}%;"></div>
          </div>
          <div style="width: 30px; text-align: right; font-size: 11px; color: #d4d4d4;">${value}</div>
        </div>
      `;
    })
    .join('');
}
