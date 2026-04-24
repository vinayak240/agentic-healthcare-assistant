FROM mongo:7.0.14

COPY infra/db/db.setup.sh /docker-entrypoint-initdb.d/db.setup.sh

RUN chmod +x /docker-entrypoint-initdb.d/db.setup.sh
