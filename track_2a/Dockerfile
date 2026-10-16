FROM python:3.12-slim
WORKDIR /app
COPY src/ /app/src/
COPY predictions/ /app/predictions_shipped/
COPY tests/ /app/tests/
COPY run.sh /app/run.sh
ENV PYTHONPATH=/app/src PYTHONUNBUFFERED=1
ENTRYPOINT ["sh", "/app/run.sh"]
