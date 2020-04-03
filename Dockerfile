FROM fedora:31

COPY . /root/dev
COPY scripts/slave /usr/bin/ 

RUN PYTHONUNBUFFERED=1 _build 

VOLUME /root/workspace 
WORKDIR /root/workspace

ENTRYPOINT ["zsh"]
