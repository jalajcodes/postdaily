import type { CarouselSlide } from "@postdaily/shared";

export interface SlideTemplate {
  name: string;
  description: string;
  slides: CarouselSlide[];
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    name: "Three tips",
    description: "Cover + 3 tips + CTA",
    slides: [
      { type: "cover", heading: "My Title", body: "Subtitle here" },
      { type: "text", heading: "Tip #1: *Bold point*", body: "Explanation goes here" },
      { type: "text", heading: "Tip #2: *Bold point*", body: "Explanation goes here" },
      { type: "text", heading: "Tip #3: *Bold point*", body: "Explanation goes here" },
      { type: "cta", heading: "Follow for more", body: "New insights every week" },
    ],
  },
  {
    name: "Problem → Solution",
    description: "Cover + before/after comparison",
    slides: [
      { type: "cover", heading: "The Problem", body: "And why it matters" },
      {
        type: "compare",
        heading: "What Changed",
        body: "",
        labels: ["Before", "After"],
        items: ["Issue 1", "Issue 2", "Issue 3"],
        items2: ["Solution 1", "Solution 2", "Solution 3"],
      },
      { type: "cta", heading: "Ready to transform?", body: "Take action today" },
    ],
  },
  {
    name: "Statistics showcase",
    description: "Cover + 3 stats + insight",
    slides: [
      { type: "cover", heading: "By The Numbers", body: "Recent findings" },
      { type: "stat", heading: "First insight", body: "Why this matters", stat: "3x" },
      { type: "stat", heading: "Second insight", body: "Why this matters", stat: "47%" },
      { type: "stat", heading: "Third insight", body: "Why this matters", stat: "$2M" },
      { type: "text", heading: "Key Takeaway", body: "What this means for you" },
    ],
  },
  {
    name: "Quote carousel",
    description: "Cover + 2 quotes + summary",
    slides: [
      { type: "cover", heading: "Wisdom From Leaders", body: "Quotes that inspire" },
      // No quote marks: the quote slide draws its own.
      { type: "quote", heading: "Great quote here", body: "Person Name" },
      { type: "quote", heading: "Another great quote", body: "Another Person" },
      { type: "text", heading: "My Thoughts", body: "What I learned from these quotes" },
    ],
  },
  {
    name: "Step-by-step guide",
    description: "Cover + checklist + conclusion",
    slides: [
      { type: "cover", heading: "How To Do It", body: "5 simple steps" },
      {
        type: "checklist",
        heading: "The Process",
        body: "",
        items: ["Step 1: First action", "Step 2: Second action", "Step 3: Third action", "Step 4: Fourth action", "Step 5: Fifth action"],
      },
      { type: "text", heading: "You're Done!", body: "Congratulations on taking action" },
    ],
  },
  {
    name: "Listicle",
    description: "Cover + numbered list + closing",
    slides: [
      { type: "cover", heading: "7 Things You Need To Know", body: "Expert insights" },
      {
        type: "list",
        heading: "The List",
        body: "",
        items: ["Point one explained", "Point two explained", "Point three explained", "Point four explained", "Point five explained", "Point six explained", "Point seven explained"],
      },
      { type: "cta", heading: "Which one surprised you?", body: "Drop your answer in the comments" },
    ],
  },
  {
    name: "Case study",
    description: "Cover + challenge + result + conclusion",
    slides: [
      { type: "cover", heading: "Case Study", body: "Real results from real work" },
      { type: "text", heading: "The Challenge", body: "What we were facing" },
      { type: "text", heading: "The Solution", body: "What we implemented" },
      { type: "stat", heading: "The Results", body: "Here's what happened", stat: "5x growth" },
      { type: "cta", heading: "Want similar results?", body: "Let's talk" },
    ],
  },
];
