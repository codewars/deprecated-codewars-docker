FROM codewars:nvmnode
MAINTAINER Ryan Hewitt "rthewitt.devel@gmail.com"

#USER noderunner
ADD bootstrap.sh /usr/local/bin/run
ADD env.sh /usr/local/bin/env.sh
ADD shim.py /usr/local/bin/run.py

USER nobody

#CMD ["/usr/local/bin/run"]
#ENTRYPOINT ["/usr/bin/python"]

CMD ["/usr/local/bin/run"]
ENTRYPOINT ["/bin/bash"]
