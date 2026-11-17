// v1.10.36 — Business-type awareness for "Recommended for" tags AND
// for actually HIDING options that are irrelevant to the active
// business type. Reported: "if I have selected freelance why it is
// still showing me retails or other option — thermal etc should also
// hide according to business type."
//
// Two helpers (moved out of PrintSettings.jsx so the panel and its
// extracted sections share one definition):
//   isRecommendedForActive(activeBiz, [...]) → shows a ★ badge on the option.
//   isVisibleFor(activeBiz, [...])           → returns true if the option
//                                              should render AT ALL. Any
//                                              option not listed here is
//                                              always visible.
//
// Empty activeBiz (user hasn't picked a preset yet) shows everything
// — no premature hiding.

// The active business preset id ("" when the user hasn't picked one).
export const getActiveBusinessPresetId = (settings) => settings.activeBusinessPresetId || '';

export const isRecommendedForActive = (activeBiz, recommendedList) => {
  if (!activeBiz) return false;
  return recommendedList.includes(activeBiz);
};

export const isVisibleFor = (activeBiz, relevantList) => {
  if (!activeBiz) return true;              // no preset → show everything
  return relevantList.includes(activeBiz);  // preset picked → only show if listed
};
