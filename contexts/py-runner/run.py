import fileinput

allofi = list(fileinput.input())
exec ''.join(allofi)
