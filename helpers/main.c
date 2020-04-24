#include <stdio.h>

int counter = 0;

void call() {
  counter++;
}

void loop() {
  for(int i=0; i < 10; i++) {
    call();
  }
}

int main() {
  loop();
}
