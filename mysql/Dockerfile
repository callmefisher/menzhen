FROM mysql:8.0
COPY my.cnf /etc/mysql/conf.d/custom.cnf
RUN sed -i 's/\r$//' /etc/mysql/conf.d/custom.cnf
