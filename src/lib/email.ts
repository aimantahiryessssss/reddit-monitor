import { Resend } from "resend";

// Lazy init so the module can be imported even when RESEND_API_KEY isn't set
// (the Resend constructor throws on an undefined key). Callers should still
// gate on the env var before calling send functions; this is just belt+braces.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  _resend = new Resend(key);
  return _resend;
}
const FROM = process.env.EMAIL_FROM || "alerts@yourdomain.com";

export interface MatchEmailData {
  userEmail: string;
  userName?: string | null;
  keyword: string;
  postTitle?: string;
  postContent?: string;
  subreddit: string;
  author: string;
  url: string;
  type: "post" | "comment";
  createdUtc: Date;
}

export async function sendMatchAlert(data: MatchEmailData) {
  const subject = `🔔 New Reddit mention: "${data.keyword}"`;
  const typeLabel = data.type === "comment" ? "Comment" : "Post";

  await getResend().emails.send({
    from: FROM,
    to: data.userEmail,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e5e5e5; padding: 40px 20px; margin: 0;">
        <div style="max-width: 560px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; overflow: hidden; border: 1px solid #2a2a2a;">
          <div style="background: linear-gradient(135deg, #ff4500, #ff6534); padding: 24px 32px;">
            <h1 style="margin: 0; color: white; font-size: 20px; font-weight: 700;">🔔 Reddit Mention Alert</h1>
            <p style="margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Keyword: <strong>"${data.keyword}"</strong></p>
          </div>
          <div style="padding: 28px 32px;">
            <div style="background: #242424; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid #ff4500;">
              <div style="font-size: 12px; color: #888; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">${typeLabel} in r/${data.subreddit}</div>
              ${data.postTitle ? `<h2 style="margin: 0 0 10px; font-size: 16px; color: #f5f5f5; line-height: 1.4;">${data.postTitle}</h2>` : ""}
              ${data.postContent ? `<p style="margin: 0; color: #aaa; font-size: 14px; line-height: 1.6;">${data.postContent.substring(0, 300)}${data.postContent.length > 300 ? "..." : ""}</p>` : ""}
            </div>
            <div style="display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
              <div style="background: #1e1e1e; border-radius: 6px; padding: 10px 14px; font-size: 13px;">
                <span style="color: #888;">Author</span><br>
                <span style="color: #f5f5f5; font-weight: 600;">u/${data.author}</span>
              </div>
              <div style="background: #1e1e1e; border-radius: 6px; padding: 10px 14px; font-size: 13px;">
                <span style="color: #888;">Subreddit</span><br>
                <span style="color: #f5f5f5; font-weight: 600;">r/${data.subreddit}</span>
              </div>
              <div style="background: #1e1e1e; border-radius: 6px; padding: 10px 14px; font-size: 13px;">
                <span style="color: #888;">Posted</span><br>
                <span style="color: #f5f5f5; font-weight: 600;">${new Date(data.createdUtc).toLocaleString()}</span>
              </div>
            </div>
            <a href="${data.url}" style="display: inline-block; background: #ff4500; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">View on Reddit →</a>
          </div>
          <div style="padding: 16px 32px; border-top: 1px solid #2a2a2a; font-size: 12px; color: #555;">
            You're receiving this because you track "${data.keyword}" on Reddit Monitor.
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

export interface DigestEmailData {
  userEmail: string;
  userName?: string | null;
  matches: {
    keyword: string;
    posts: {
      title?: string;
      subreddit: string;
      author: string;
      url: string;
      type: string;
      createdUtc: Date;
    }[];
  }[];
  date: string;
  totalMatches: number;
  topSubreddits: string[];
  trendingKeyword: string;
}

export async function sendDailyDigest(data: DigestEmailData) {
  const subject = `📊 Your Reddit Daily Digest — ${data.date}`;

  const keywordSections = data.matches
    .map(
      (group) => `
      <div style="margin-bottom: 28px;">
        <h3 style="margin: 0 0 12px; color: #ff4500; font-size: 15px;">"${group.keyword}" — ${group.posts.length} mention${group.posts.length !== 1 ? "s" : ""}</h3>
        ${group.posts
          .slice(0, 5)
          .map(
            (post) => `
          <div style="background: #242424; border-radius: 6px; padding: 14px; margin-bottom: 8px; border-left: 3px solid #333;">
            ${post.title ? `<div style="color: #f5f5f5; font-weight: 600; font-size: 14px; margin-bottom: 4px;">${post.title}</div>` : `<div style="color: #888; font-size: 13px; font-style: italic;">[Comment]</div>`}
            <div style="font-size: 12px; color: #888;">r/${post.subreddit} • u/${post.author}</div>
            <a href="${post.url}" style="font-size: 12px; color: #ff4500; text-decoration: none;">View →</a>
          </div>
        `
          )
          .join("")}
        ${group.posts.length > 5 ? `<div style="font-size: 12px; color: #888; padding-left: 4px;">+${group.posts.length - 5} more mentions...</div>` : ""}
      </div>
    `
    )
    .join("");

  await getResend().emails.send({
    from: FROM,
    to: data.userEmail,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e5e5e5; padding: 40px 20px; margin: 0;">
        <div style="max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; overflow: hidden; border: 1px solid #2a2a2a;">
          <div style="background: linear-gradient(135deg, #ff4500, #ff6534); padding: 24px 32px;">
            <h1 style="margin: 0; color: white; font-size: 22px; font-weight: 700;">📊 Daily Reddit Digest</h1>
            <p style="margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">${data.date}</p>
          </div>
          <div style="padding: 28px 32px;">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px;">
              <div style="background: #242424; border-radius: 8px; padding: 16px; text-align: center;">
                <div style="font-size: 28px; font-weight: 700; color: #ff4500;">${data.totalMatches}</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">Total Mentions</div>
              </div>
              <div style="background: #242424; border-radius: 8px; padding: 16px; text-align: center;">
                <div style="font-size: 18px; font-weight: 700; color: #f5f5f5;">${data.trendingKeyword}</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">🔥 Trending</div>
              </div>
              <div style="background: #242424; border-radius: 8px; padding: 16px; text-align: center;">
                <div style="font-size: 14px; font-weight: 600; color: #f5f5f5;">${data.topSubreddits.slice(0, 2).join(", ") || "—"}</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">Top Subreddits</div>
              </div>
            </div>
            <h2 style="margin: 0 0 20px; font-size: 16px; color: #f5f5f5; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px;">Mentions by Keyword</h2>
            ${keywordSections}
          </div>
          <div style="padding: 16px 32px; border-top: 1px solid #2a2a2a; font-size: 12px; color: #555;">
            Reddit Monitor Daily Digest • Manage your preferences in the dashboard
          </div>
        </div>
      </body>
      </html>
    `,
  });
}
