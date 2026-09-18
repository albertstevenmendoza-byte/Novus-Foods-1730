"""
Your L2L settings. Put your real API key below before running the sync
script. Not meant to be committed to a public repo with the real key in
it — see the note in README_L2L_SYNC.md.
"""

COMPANY = "lakeviewfarms"
API_KEY = "U46cAWP6H0kWTpDDAOQUyo9OqyhuqUTy"
SITE_NUMBER = 2

# L2L's internal line codes -> the line codes already used throughout
# this dashboard (dds-dashboard.html's buildProdSection calls use these
# exact codes: '2A','PL1','MP4','PXM6','PL2','2E').
LINECODE_DICT = {
    "BP-LINE1": "2A", "BP-LINE2": "PXM6", "BP-LINE3": "MP4",
    "BP-LINE4": "PL1", "BP-LINE5": "PL2", "BP-LINE6": "2E"
}
LINE_CODES = list(LINECODE_DICT.keys())

# Dispatch Type ids at this site (found via /dispatchtypes/)
CODE_RED_ID = 205      # "Machine Down (not Producing)"
CODE_YELLOW_ID = 206   # "Machine Limping Along (below rate)"
