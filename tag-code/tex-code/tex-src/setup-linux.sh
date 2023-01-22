# install latext compiler

```
$ sudo apt install texlive-full
```

# perl doc
```
$ apt-get install perl-doc
```

# generate UUID
```
sudo apt-get install uuid-runtime
```

# poppler
```
sudo apt-get install libpoppler-dev
sudo apt-get install -qq -y pkg-config libfontforge-dev poppler-data poppler-utils
sudo apt-get install -y libopenjp2-7-dev

POPPLER_SOURCE="http://poppler.freedesktop.org/poppler-0.33.0.tar.xz"
wget "$POPPLER_SOURCE"
tar -xvf poppler-0.33.0.tar.xz
cd poppler-0.33.0/
./configure --enable-xpdf-headers
make
make install

sudo apt-get install libcairo2-dev
sudo apt install libfontforge-dev
sudo apt-get install -y libsdl-pango-dev

```

```
cmake .
make
sudo make install
```

# setup
git clone https://github.com/latex2html/latex2html.git
```
$ ./configure
$ make
$ sudo make install
```

# hogo install
```
sudo apt install hugo
```