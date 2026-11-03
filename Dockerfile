FROM python:3.11-slim
WORKDIR /app
RUN groupadd --gid 10001 ledger && useradd --uid 10001 --gid ledger ledger && mkdir /data && chown ledger:ledger /data
COPY --chown=ledger:ledger ledger.py server.py ./
COPY --chown=ledger:ledger public ./public
COPY --chown=ledger:ledger fixtures ./fixtures
USER ledger
ENV LEDGER_DATA=/data LEDGER_BIND=0.0.0.0 PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python3", "server.py"]
