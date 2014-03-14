FROM codewars:base
MAINTAINER Ryan Hewitt "rthewitt.devel@gmail.com"

RUN apt-get -qq update
RUN apt-get install -y python-dev python-setuptools git-core
RUN easy_install pip
RUN pip install virtualenv
RUN virtualenv --no-site-packages /opt/ve/pyrunner
ADD . /opt/apps/pyrunner
ADD bootstrap.sh /usr/local/bin/run
ADD err.sh /usr/local/bin/errorhack 

#RUN (cd /opt/apps/pyrunner && git remote rm origin)
#RUN (cd /opt/apps/pyrunner && git remote add origin https://github.com/rthewitt/XXX.git)

# Simple requirements changes should allow for more complex environments
RUN /opt/ve/pyrunner/bin/pip install -r /opt/apps/pyrunner/requirements.txt

USER nobody
CMD ["/usr/local/bin/run", "/opt/ve/pyrunner/bin/python", "/opt/apps/pyrunner/run.py"]
ENTRYPOINT ["/bin/bash"]
