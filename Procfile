# In-process state (rate limits, agent sessions, confirmations) requires --workers 1.
web: gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120 server:app
