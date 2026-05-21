// Sanity-check intent scorer.
import { intentScore, isHighIntent } from "../src/lib/relevance";

const cases = [
  {
    label: "USER'S EXAMPLE — should PASS",
    item: {
      title: "How do you manage your client approvals?",
      content: "Looking for a better workflow for social media management at my agency. Currently using spreadsheets.",
      subreddit: "SocialMediaMarketing",
    },
  },
  {
    label: "Tool comparison — should PASS",
    item: {
      title: "Hootsuite alternatives for small business",
      content: "Tired of Hootsuite's pricing. Anyone recommend a better tool?",
      subreddit: "smallbusiness",
    },
  },
  {
    label: "Career advice — should DROP",
    item: {
      title: "How to start a career in social media management",
      content: "I'm 22 and want to learn social media management as a career path.",
      subreddit: "AskReddit",
    },
  },
  {
    label: "Internship ask — should DROP",
    item: {
      title: "Looking for a social media management internship",
      content: "Recent grad seeking internship. Resume attached.",
      subreddit: "Internships",
    },
  },
  {
    label: "Random rant — should DROP",
    item: {
      title: "Social media management is exhausting",
      content: "Just venting about the workload.",
      subreddit: "rant",
    },
  },
  {
    label: "Pain-point post — should PASS",
    item: {
      title: "I'm wasting hours every week posting manually",
      content: "Currently use spreadsheets to track social media management. Need a scheduler.",
      subreddit: "Entrepreneur",
    },
  },
];

for (const c of cases) {
  const s = intentScore(c.item);
  const pass = isHighIntent(c.item);
  console.log(`[${pass ? "PASS" : "DROP"}] score=${s.toString().padStart(3)} — ${c.label}`);
}
