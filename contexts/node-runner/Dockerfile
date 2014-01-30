FROM codewars:nvmnode
MAINTAINER Ryan Hewitt "rthewitt.devel@gmail.com"

USER noderunner

ADD bootstrap.sh /usr/local/bin/run

# Runs in current shell context
CMD ["/usr/local/bin/run"]
ENTRYPOINT ["/bin/bash"]
