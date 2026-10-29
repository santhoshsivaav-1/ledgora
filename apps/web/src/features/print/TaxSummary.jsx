

// The tax rows of the totals box: IGST, or CGST and SGST (UTGST in a union territory), or one combined tax line (change 3.9).
export default function TaxSummary({
  fmt, isIndia, isInterstate, showGST, taxLabel, totals,
}) {
  return (
    <>
          {showGST && (
            isIndia && isInterstate ? (
              <div className="inv-total-row">
                <span>IGST</span>
                <span>{fmt(totals.igst)}</span>
              </div>
            ) : isIndia ? (
              <>
                <div className="inv-total-row">
                  <span>CGST</span>
                  <span>{fmt(totals.cgst)}</span>
                </div>
                {/* Intra-UT supplies charge UTGST, not SGST: this row read
                    "SGST 0.00" and the UTGST was missing from the printout. */}
                <div className="inv-total-row">
                  <span>{totals.isIntraUT ? 'UTGST' : 'SGST'}</span>
                  <span>{fmt((totals.sgst || 0) + (totals.utgst || 0))}</span>
                </div>
              </>
            ) : (
              <div className="inv-total-row">
                <span>{taxLabel}</span>
                <span>{fmt((totals.cgst || 0) + (totals.sgst || 0) + (totals.igst || 0))}</span>
              </div>
            )
          )}
    </>
  );
}
